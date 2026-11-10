import { basename } from "node:path";
import {
  convertToLlm,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  estimateTokens,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { type FailureStage, failureDiagnostics } from "./diagnostics.ts";
import { generatedTitle, literalTitle, namingPrompt, textContent } from "./naming.ts";

const STATE_KEY = "pi-rename2";
const STATUS_KEY = "pi-rename2";
const MAX_OUTPUT_TOKENS = 256;
// Headroom for request framing that Pi's token estimate does not count.
const BUDGET_MARGIN_TOKENS = 32;
const HISTORY_SIZE = 5;

type Model = NonNullable<ExtensionContext["model"]>;
type Messages = ReturnType<typeof convertToLlm>;
type ModelResponse = Awaited<
  ReturnType<ReturnType<ExtensionContext["modelRegistry"]["streamSimple"]>["result"]>
>;

type FailureCode =
  | "no-model"
  | "no-auth"
  | "no-conversation"
  | "context-limit"
  | "unexpected-tools"
  | "incomplete-title"
  | "invalid-title"
  | "timeout"
  | "provider";

const FAILURE_MESSAGES: Record<FailureCode, string> = {
  "no-model": "No session model selected. Select a model, then run /rename.",
  "no-auth": "The selected model has no configured authentication. Sign in, then run /rename.",
  "no-conversation": "No conversation context is available to name. Use /rename <title> instead.",
  "context-limit":
    "The session needs more context space for a title request. Use /compact, then /rename, or supply a title.",
  "unexpected-tools":
    "The model requested tools instead of a title. No tools were executed. Run /rename again or supply a title.",
  "incomplete-title":
    "The model ran out of output space for a complete title. Run /rename again or supply a title.",
  "invalid-title": "The model returned no usable title. Run /rename again or supply a title.",
  timeout: "Session naming timed out. Run /rename to try again.",
  provider: "Session naming failed. Check model access, then run /rename again.",
};

/** Internal failure with a known code. Provider errors never use this class. */
class NamingFailure extends Error {
  readonly code: FailureCode;

  constructor(code: FailureCode) {
    super(code);
    this.code = code;
  }
}

interface State {
  version: 1;
  attempted: boolean;
  titles: string[];
}

interface Request {
  controller: AbortController;
  ctx: ExtensionContext;
  timedOut: boolean;
}

function restore(entries: readonly SessionEntry[]): State {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== STATE_KEY) {
      continue;
    }

    const value = entry.data as Partial<State> | undefined;
    if (
      value?.version === 1 &&
      typeof value.attempted === "boolean" &&
      Array.isArray(value.titles)
    ) {
      return {
        version: 1,
        attempted: value.attempted,
        titles: value.titles
          .filter((title): title is string => typeof title === "string")
          .slice(-HISTORY_SIZE),
      };
    }
  }

  return { version: 1, attempted: false, titles: [] };
}

/** Build an isolated continuation of Pi's effective, already-compacted transcript. */
function titleContext(
  ctx: ExtensionContext,
  model: Model,
  current: string | undefined,
  history: readonly string[],
): { messages: Messages; maxTokens: number } {
  const converted = convertToLlm(ctx.sessionManager.buildSessionProjection().messages);
  if (!converted.some((message) => message.role !== "system")) {
    throw new NamingFailure("no-conversation");
  }

  // Providers may normalize messages in place. Never lend them live session objects.
  const messages = structuredClone(converted);
  if (!messages.some((message) => message.role === "system")) {
    // Older imported sessions may not yet contain Pi's persisted system checkpoint.
    messages.unshift({ role: "system", content: ctx.getSystemPrompt(), timestamp: Date.now() });
  }

  const instruction = {
    role: "user" as const,
    content: namingPrompt(current, history, basename(ctx.cwd)),
    timestamp: Date.now(),
  };
  const maxTokens = Math.min(MAX_OUTPUT_TOKENS, model.maxTokens);
  const contextTokens =
    ctx.getContextUsage()?.tokens ??
    messages.reduce((total, message) => total + estimateTokens(message), 0);
  const required = contextTokens + estimateTokens(instruction) + maxTokens + BUDGET_MARGIN_TOKENS;
  // Pi's estimate is not a provider tokenizer. Do not silently truncate or compact.
  if (required > model.contextWindow) {
    throw new NamingFailure("context-limit");
  }

  messages.push(instruction);
  return { messages, maxTokens };
}

/** Call the model once. Rejects on abort even if the provider ignores the signal. */
async function callModel(
  request: Request,
  model: Model,
  context: { messages: Messages; maxTokens: number },
  timeoutMs: number,
): Promise<ModelResponse> {
  const { ctx, controller } = request;
  let releaseAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const listener = () => reject(new Error("aborted"));
    controller.signal.addEventListener("abort", listener, { once: true });
    releaseAbort = () => controller.signal.removeEventListener("abort", listener);
  });
  const timer = setTimeout(() => {
    request.timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const stream = ctx.modelRegistry.streamSimple(
      model,
      { messages: context.messages },
      {
        signal: controller.signal,
        reasoning: "off",
        maxTokens: context.maxTokens,
        sessionId: ctx.sessionManager.getSessionId(),
        // Keep cache affinity, but do not branch a live stateful WebSocket connection.
        transport: "sse",
      },
    );
    return await Promise.race([stream.result(), aborted]);
  } finally {
    clearTimeout(timer);
    releaseAbort?.();
  }
}

/** Turn an accepted model response into a title, or throw a known failure. */
function titleFrom(response: ModelResponse): string {
  if (
    response.stopReason === "toolUse" ||
    response.content.some((block) => block.type === "toolCall")
  ) {
    throw new NamingFailure("unexpected-tools");
  }
  if (response.stopReason === "length") {
    throw new NamingFailure("incomplete-title");
  }

  const title = generatedTitle(textContent(response.content));
  if (!title) {
    throw new NamingFailure("invalid-title");
  }
  return title;
}

const isProviderError = (response: ModelResponse) =>
  response.stopReason === "error" || response.stopReason === "aborted";

/** Build a user-facing warning. Never render raw provider errors: they can hold private data. */
function failureNotice(
  error: unknown,
  timedOut: boolean,
  maxTokens: number | undefined,
  response: ModelResponse | undefined,
): string {
  const code = timedOut ? "timeout" : error instanceof NamingFailure ? error.code : "provider";

  let stage: FailureStage = "validation";
  if (maxTokens === undefined) {
    stage = "preflight";
  } else if (!response) {
    stage = "request";
  } else if (isProviderError(response)) {
    stage = "provider-response";
  }

  const cause = stage === "provider-response" ? response?.errorMessage : error;
  return `${FAILURE_MESSAGES[code]}\n${failureDiagnostics(stage, cause, maxTokens, response)}`;
}

/** Register the extension. The timeout override is for offline lifecycle tests. */
export function registerRename(pi: ExtensionAPI, timeoutMs = 180_000): void {
  let state: State = { version: 1, attempted: false, titles: [] };
  let eligible = false;
  let awaitingReply = false;
  let active: Request | undefined;

  const notify = (ctx: ExtensionContext, message: string, kind: "info" | "warning" = "info") => {
    if (ctx.hasUI) {
      ctx.ui.notify(message, kind);
    }
  };

  const setStatus = (ctx: ExtensionContext, text: string | undefined) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, text);
    }
  };

  const save = () => pi.appendEntry(STATE_KEY, { ...state, titles: [...state.titles] });

  const cancel = () => {
    if (active) {
      active.controller.abort();
      setStatus(active.ctx, undefined);
      active = undefined;
    }
  };

  const begin = (ctx: ExtensionContext): Request => {
    cancel();
    active = { controller: new AbortController(), ctx, timedOut: false };
    return active;
  };

  // Every cancellation path clears `active`, so identity alone tells whether a request is current.
  const valid = (request: Request) => active === request && !request.controller.signal.aborted;

  const generate = async (request: Request): Promise<void> => {
    const { ctx } = request;
    const startingTitle = pi.getSessionName();
    let maxTokens: number | undefined;
    let response: ModelResponse | undefined;

    try {
      if (!valid(request)) {
        return;
      }
      setStatus(ctx, "Renaming session...");

      const model = ctx.model;
      if (!model) {
        throw new NamingFailure("no-model");
      }
      if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
        throw new NamingFailure("no-auth");
      }

      const context = titleContext(ctx, model, startingTitle, state.titles);
      maxTokens = context.maxTokens;
      response = await callModel(request, model, context, timeoutMs);

      if (!valid(request) || pi.getSessionName() !== startingTitle) {
        return;
      }
      if (isProviderError(response)) {
        throw new NamingFailure("provider");
      }
      const title = titleFrom(response);

      // Metadata is written before setting the name, whose change event cancels requests.
      state.titles = [...state.titles, title].slice(-HISTORY_SIZE);
      save();
      pi.setSessionName(title);
      notify(ctx, `Session named: ${title}`);
    } catch (error) {
      // Superseded or cancelled work is discarded silently. Timeouts still warn.
      if (active !== request || (request.controller.signal.aborted && !request.timedOut)) {
        return;
      }
      notify(ctx, failureNotice(error, request.timedOut, maxTokens, response), "warning");
    } finally {
      if (active === request) {
        setStatus(ctx, undefined);
        active = undefined;
      }
    }
  };

  pi.on("session_start", (event, ctx) => {
    cancel();
    const entries = ctx.sessionManager.getBranch();
    state = restore(entries);
    const hasConversation = entries.some(
      (entry) => entry.type === "message" || entry.type === "compaction",
    );
    eligible =
      ctx.mode === "tui" &&
      (event.reason === "startup" || event.reason === "new") &&
      !ctx.sessionManager.getHeader()?.parentSession &&
      !hasConversation &&
      !state.attempted &&
      !pi.getSessionName();
    awaitingReply = false;
  });

  pi.on("before_agent_start", (event) => {
    if (event.messageType === "user" && eligible) {
      awaitingReply = true;
    }
  });

  pi.on("agent_settled", (event, ctx) => {
    if (!eligible || !awaitingReply) {
      return;
    }
    awaitingReply = false;
    if (event.aborted || pi.getSessionName()) {
      return;
    }
    const messages = ctx.sessionManager.buildSessionProjection().messages;
    const reply = messages.findLast((message) => message.role === "assistant");
    if (
      reply?.role !== "assistant" ||
      reply.stopReason === "error" ||
      reply.stopReason === "aborted"
    ) {
      return;
    }
    eligible = false;
    state.attempted = true;
    save();
    // Fire and forget: do not hold Pi's settlement boundary open for a model call.
    void generate(begin(ctx));
  });

  pi.on("session_info_changed", () => {
    eligible = false;
    cancel();
  });

  pi.on("session_before_tree", () => {
    cancel();
  });

  pi.on("session_tree", (_event, ctx) => {
    eligible = false;
    awaitingReply = false;
    cancel();
    state = restore(ctx.sessionManager.getBranch());
  });

  pi.on("session_shutdown", () => {
    eligible = false;
    awaitingReply = false;
    cancel();
  });

  pi.registerCommand("rename", {
    description: "Generate a specific session title, or set one with /rename <title>",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const isLiteral = args.trim() !== "";
      const title = isLiteral ? literalTitle(args) : undefined;
      if (isLiteral && !title) {
        notify(ctx, "A session title must be one line without control characters.", "warning");
        return;
      }

      eligible = false;
      awaitingReply = false;
      state.attempted = true;

      if (title) {
        cancel();
        save();
        pi.setSessionName(title);
        notify(ctx, `Session named: ${title}`);
        return;
      }

      const request = begin(ctx);
      save();
      try {
        if (!ctx.isIdle()) {
          await ctx.waitForIdle();
        }
        if (valid(request)) {
          await generate(request);
        }
      } catch {
        // generate() handles its own errors, so this is a failed idle wait.
        if (valid(request)) {
          notify(
            ctx,
            "Could not wait for the session to become idle. Run /rename again.",
            "warning",
          );
        }
      } finally {
        if (active === request) {
          cancel();
        }
      }
    },
  });
}

export default function rename(pi: ExtensionAPI): void {
  registerRename(pi);
}

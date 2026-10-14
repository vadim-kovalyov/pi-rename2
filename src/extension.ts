import { basename } from "node:path";
import {
  convertToLlm,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  estimateTokens,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { generatedTitle, literalTitle, namingPrompt, textContent } from "./naming.ts";

const STATE_KEY = "pi-rename2";
const STATUS_KEY = "pi-rename2";

interface State {
  version: 1;
  attempted: boolean;
  titles: string[];
}

interface Request {
  id: number;
  controller: AbortController;
  ctx: ExtensionContext;
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
          .slice(-5),
      };
    }
  }

  return { version: 1, attempted: false, titles: [] };
}

/** Build an isolated continuation of Pi's effective, already-compacted transcript. */
function titleContext(
  ctx: ExtensionContext,
  model: { contextWindow: number; maxTokens: number },
  current: string | undefined,
  history: readonly string[],
) {
  const projected = ctx.sessionManager.buildSessionProjection().messages;
  const converted = convertToLlm(projected);
  if (!converted.some((message) => message.role !== "system")) {
    throw new Error("no-conversation");
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
  const maxTokens = Math.min(256, model.maxTokens);
  const contextTokens =
    ctx.getContextUsage()?.tokens ??
    messages.reduce((total, message) => total + estimateTokens(message), 0);
  // Pi's estimate is not a provider tokenizer. Do not silently truncate or compact.
  if (contextTokens + estimateTokens(instruction) + maxTokens + 32 > model.contextWindow) {
    throw new Error("context-limit");
  }

  messages.push(instruction);
  return { messages, maxTokens };
}

/** Register the extension. The timeout override is for offline lifecycle tests. */
export function registerRename(pi: ExtensionAPI, timeoutMs = 180_000): void {
  let state: State = { version: 1, attempted: false, titles: [] };
  let sessionId: string | undefined;
  let eligible = false;
  let awaitingReply = false;
  let serial = 0;
  let active: Request | undefined;

  const notify = (ctx: ExtensionContext, message: string, kind: "info" | "warning" = "info") => {
    if (ctx.hasUI) {
      ctx.ui.notify(message, kind);
    }
  };

  const save = () => pi.appendEntry(STATE_KEY, { ...state, titles: [...state.titles] });

  const cancel = () => {
    serial++;
    if (active) {
      active.controller.abort();
      if (active.ctx.hasUI) {
        active.ctx.ui.setStatus(STATUS_KEY, undefined);
      }
      active = undefined;
    }
  };

  const begin = (ctx: ExtensionContext): Request => {
    cancel();
    const request = { id: serial, controller: new AbortController(), ctx };
    active = request;
    return request;
  };

  const valid = (request: Request) =>
    active === request &&
    request.id === serial &&
    sessionId === request.ctx.sessionManager.getSessionId() &&
    !request.controller.signal.aborted;

  const generate = async (request: Request): Promise<void> => {
    const { ctx, controller } = request;
    const startingTitle = pi.getSessionName();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let releaseAbort: (() => void) | undefined;
    let timedOut = false;

    try {
      if (!valid(request)) {
        return;
      }
      if (ctx.hasUI) {
        ctx.ui.setStatus(STATUS_KEY, "Renaming session...");
      }

      const model = ctx.model;
      if (!model) {
        throw new Error("no-model");
      }
      if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
        throw new Error("no-auth");
      }

      const context = titleContext(ctx, model, startingTitle, state.titles);

      const aborted = new Promise<never>((_resolve, reject) => {
        const listener = () => reject(new Error(timedOut ? "timeout" : "cancelled"));
        controller.signal.addEventListener("abort", listener, { once: true });
        releaseAbort = () => controller.signal.removeEventListener("abort", listener);
      });
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      const response = await Promise.race([
        ctx.modelRegistry
          .streamSimple(
            model,
            { messages: context.messages },
            {
              signal: controller.signal,
              reasoning: "minimal",
              maxTokens: context.maxTokens,
              sessionId: ctx.sessionManager.getSessionId(),
              // Keep cache affinity, but do not branch a live stateful WebSocket connection.
              transport: "sse",
            },
          )
          .result(),
        aborted,
      ]);

      if (!valid(request) || pi.getSessionName() !== startingTitle) {
        return;
      }
      if (response.stopReason === "error" || response.stopReason === "aborted") {
        throw new Error("provider");
      }
      if (
        response.stopReason === "toolUse" ||
        response.content.some((block) => block.type === "toolCall")
      ) {
        throw new Error("unexpected-tools");
      }
      if (response.stopReason === "length") {
        throw new Error("incomplete-title");
      }
      const title = generatedTitle(textContent(response.content));

      // Metadata is written before setting the name, whose change event cancels requests.
      state.titles = [...state.titles, title].slice(-5);
      save();
      pi.setSessionName(title);
      notify(ctx, `Session named: ${title}`);
    } catch (error) {
      // Never render raw provider errors: they can contain headers or private input.
      if (
        active !== request ||
        request.id !== serial ||
        sessionId !== ctx.sessionManager.getSessionId()
      ) {
        return;
      }
      if (controller.signal.aborted && !timedOut) {
        return;
      }

      const code = error instanceof Error ? error.message : "provider";
      const messages: Record<string, string> = {
        "no-model": "No session model selected. Select a model, then run /rename.",
        "no-auth":
          "The selected model has no configured authentication. Sign in, then run /rename.",
        "no-conversation":
          "No conversation context is available to name. Use /rename <title> instead.",
        "context-limit":
          "The session needs more context space for a title request. Use /compact, then /rename, or supply a title.",
        "unexpected-tools":
          "The model requested tools instead of a title. No tools were executed. Run /rename again or supply a title.",
        "incomplete-title":
          "The model ran out of output space for a complete title. Run /rename again or supply a title.",
        "invalid-title": "The model returned no usable title. Run /rename again or supply a title.",
        timeout: "Session naming timed out. Run /rename to try again.",
      };
      notify(
        ctx,
        timedOut
          ? messages.timeout!
          : (messages[code] ??
              "Session naming failed. Check model access, then run /rename again."),
        "warning",
      );
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      releaseAbort?.();

      if (active === request) {
        if (ctx.hasUI) {
          ctx.ui.setStatus(STATUS_KEY, undefined);
        }
        active = undefined;
      }
    }
  };

  pi.on("session_start", (event, ctx) => {
    cancel();
    sessionId = ctx.sessionManager.getSessionId();
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
    sessionId = undefined;
  });

  pi.registerCommand("rename", {
    description: "Generate a specific session title, or set one with /rename <title>",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      let title: string;

      try {
        title = args.trim() ? literalTitle(args) : "";
      } catch {
        notify(ctx, "A session title must be one line without control characters.", "warning");
        return;
      }

      eligible = false;
      awaitingReply = false;
      state.attempted = true;
      const request = begin(ctx);
      save();

      if (title) {
        pi.setSessionName(title);
        notify(ctx, `Session named: ${title}`);
        if (active === request) {
          cancel();
        }
        return;
      }

      try {
        if (!ctx.isIdle()) {
          await ctx.waitForIdle();
        }
        if (valid(request)) {
          await generate(request);
        }
      } catch {
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { registerRename } from "../src/extension.ts";

function assistant(text: string, stopReason: "stop" | "error" | "aborted" = "stop") {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses" as const,
    provider: "test",
    model: "test-model",
    stopReason,
    timestamp: Date.now(),
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

type EventHandler = (event: Record<string, unknown>, ctx: ExtensionCommandContext) => unknown;
type Call = {
  model: unknown;
  context: { systemPrompt: string; messages: { content: string }[] };
  options: { signal: AbortSignal; reasoning: string; sessionId: string };
};

function fixture(timeout = 1000) {
  const sm = SessionManager.inMemory("/sample-project");
  const events = new Map<string, EventHandler>();
  const notices: { text: string; kind: string }[] = [];
  const statuses: (string | undefined)[] = [];
  const calls: Call[] = [];
  let command!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
  let next: () => Promise<ReturnType<typeof assistant>> = async () =>
    assistant("Discovery: investigate duplicate registrations");
  let idle = true;
  let idleWait = async () => {};
  let auth = true;

  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: "/sample-project",
    sessionManager: sm,
    model: { id: "test-model", provider: "test" },
    ui: {
      notify: (text: string, kind: string) => notices.push({ text, kind }),
      setStatus: (_key: string, text: string | undefined) => statuses.push(text),
    },
    modelRegistry: {
      hasConfiguredAuth: () => auth,
      streamSimple: (model: unknown, context: Call["context"], options: Call["options"]) => {
        calls.push({ model, context, options });
        return { result: next };
      },
    },
    isIdle: () => idle,
    waitForIdle: () => idleWait(),
  } as unknown as ExtensionCommandContext;

  const api = {
    on: (name: string, handler: EventHandler) => {
      events.set(name, handler);
    },
    registerCommand: (_name: string, definition: { handler: typeof command }) => {
      command = definition.handler;
    },
    getSessionName: () => sm.getSessionName(),
    setSessionName: (name: string) => {
      sm.appendSessionInfo(name);
      void events.get("session_info_changed")?.({ name }, ctx);
    },
    appendEntry: (type: string, data: unknown) => {
      sm.appendCustomEntry(type, data);
    },
  };

  const install = () => {
    events.clear();
    registerRename(api as unknown as ExtensionAPI, timeout);
  };
  install();

  const emit = async (name: string, event: Record<string, unknown> = {}) => {
    await events.get(name)?.(event, ctx);
  };
  const user = (content = "Investigate duplicate registrations") =>
    sm.appendMessage({ role: "user", content, timestamp: Date.now() });
  const reply = () => sm.appendMessage(assistant("Investigate registration retry ownership"));
  const start = (reason = "startup") => emit("session_start", { reason });
  const finish = async (aborted = false) => {
    await emit("agent_settled", { aborted });
    await tick();
  };
  const firstReply = async () => {
    await emit("before_agent_start", { messageType: "user" });
    user();
    reply();
    await finish();
  };

  return {
    sm,
    ctx,
    api,
    calls,
    notices,
    statuses,
    emit,
    user,
    reply,
    start,
    finish,
    firstReply,
    install,
    rename: (args = "") => command(args, ctx),
    setNext: (value: typeof next) => {
      next = value;
    },
    setAuth: (value: boolean) => {
      auth = value;
    },
    setBusy: (wait: () => Promise<void>) => {
      idle = false;
      idleWait = wait;
    },
  };
}

test("fresh interactive session names once, only after first completed reply", async () => {
  const f = fixture();
  await f.start();
  await f.emit("before_agent_start", { messageType: "user" });
  f.user();
  assert.equal(f.calls.length, 0);

  f.reply();
  await f.finish();

  assert.equal(f.calls.length, 1);
  assert.equal(f.sm.getSessionName(), "Discovery: investigate duplicate registrations");

  await f.firstReply();
  assert.equal(f.calls.length, 1);
  assert.equal(f.statuses.at(-1), undefined);
  assert.equal(f.sm.getBranch().filter((entry) => entry.type === "message").length, 4);
});

test("automatic generation is background work and does not hold settlement open", async () => {
  const f = fixture();
  const pending = deferred<ReturnType<typeof assistant>>();
  f.setNext(() => pending.promise);
  await f.start();
  await f.firstReply();
  assert.equal(f.calls.length, 1);
  assert.equal(f.sm.getSessionName(), undefined);

  pending.resolve(assistant("Discovery: inspect registration ownership"));
  await tick();
  assert.equal(f.sm.getSessionName(), "Discovery: inspect registration ownership");
});

test("existing names, resumed history, forks, reloads, and non-TUI modes skip auto naming", async (t) => {
  for (const scenario of [
    "named",
    "history",
    "resume",
    "fork",
    "reload",
    "rpc",
    "print",
    "json",
  ] as const) {
    await t.test(scenario, async () => {
      const f = fixture();
      if (scenario === "named") {
        f.api.setSessionName("Keep this title");
      }
      if (scenario === "history") {
        f.user();
      }
      if (["rpc", "print", "json"].includes(scenario)) {
        f.ctx.mode = scenario as "rpc" | "print" | "json";
      }

      await f.start(["resume", "fork", "reload"].includes(scenario) ? scenario : "startup");
      await f.firstReply();
      assert.equal(f.calls.length, 0);
    });
  }
});

test("custom-triggered runs and aborted runs do not auto name", async () => {
  const f = fixture();
  await f.start();
  await f.emit("before_agent_start", { messageType: "custom" });
  f.reply();
  await f.finish();
  assert.equal(f.calls.length, 0);
  await f.emit("before_agent_start", { messageType: "user" });
  f.user();
  await f.finish(true);
  assert.equal(f.calls.length, 0);
  await f.firstReply();
  assert.equal(f.calls.length, 1);
});

test("literal rename is immediate, preserves long wording, and makes zero model calls", async () => {
  const f = fixture();
  await f.start();
  const title = `Explore ${"discovery details ".repeat(8).trim()}`;
  await f.rename(`  ${title}  `);
  assert.equal(f.sm.getSessionName(), title);
  assert.equal(f.calls.length, 0);
  await f.firstReply();
  assert.equal(f.calls.length, 0);
  await f.rename("bad\nname");
  assert.equal(f.sm.getSessionName(), title);
  assert.match(f.notices.at(-1)!.text, /control characters/);
});

test("whitespace generates; repeated requests use one call and accept the same title", async () => {
  const f = fixture();
  await f.start();
  f.user();
  f.reply();
  await f.rename("   ");
  await f.rename();
  assert.equal(f.calls.length, 2);
  const input = JSON.parse(f.calls[1]!.context.messages[0]!.content);
  assert.equal(input.currentTitle, "Discovery: investigate duplicate registrations");
  assert.deepEqual(input.previousTitles, ["Discovery: investigate duplicate registrations"]);
  assert.equal(f.calls[0]!.model, f.ctx.model);
  assert.equal(f.calls[0]!.options.reasoning, "minimal");
  assert.notEqual(f.calls[0]!.options.sessionId, f.calls[1]!.options.sessionId);
  assert.match(f.calls[0]!.context.systemPrompt, /whole-session theme/);
});

test("metadata and last five generated titles survive reload without auto naming", async () => {
  const f = fixture();
  await f.start();
  f.user();
  f.reply();
  let index = 0;
  f.setNext(async () => assistant(`Discovery: investigate retry option ${++index}`));
  for (let count = 0; count < 7; count++) {
    await f.rename();
  }
  await f.emit("session_shutdown", { reason: "reload" });
  f.install();
  await f.start("reload");
  await f.firstReply();
  assert.equal(f.calls.length, 7);
  await f.rename();
  const input = JSON.parse(f.calls.at(-1)!.context.messages[0]!.content);
  assert.equal(input.previousTitles.length, 5);
  assert.match(input.previousTitles[0], /option 3$/);
});

test("provider failure is sanitized, preserves title, clears status, and never auto retries", async () => {
  const f = fixture();
  await f.start();
  f.setNext(async () => {
    throw new Error("PRIVATE_PROVIDER_PAYLOAD");
  });
  await f.firstReply();
  await f.firstReply();
  assert.equal(f.calls.length, 1);
  assert.equal(f.sm.getSessionName(), undefined);
  assert.doesNotMatch(JSON.stringify(f.notices), /PRIVATE_PROVIDER_PAYLOAD/);
  assert.equal(f.statuses.at(-1), undefined);
  f.api.setSessionName("Existing title");
  await f.rename();
  assert.equal(f.sm.getSessionName(), "Existing title");
});

test("missing model, auth, conversation, invalid output, and provider error are safe", async (t) => {
  for (const problem of ["model", "auth", "conversation", "invalid", "error", "aborted"] as const) {
    await t.test(problem, async () => {
      const f = fixture();
      await f.start();
      if (problem !== "conversation") {
        f.user();
        f.reply();
      }
      f.api.setSessionName("Keep title");
      if (problem === "model") {
        f.ctx.model = undefined;
      }
      if (problem === "auth") {
        f.setAuth(false);
      }
      if (problem === "invalid") {
        f.setNext(async () => assistant(""));
      }
      if (problem === "error" || problem === "aborted") {
        f.setNext(async () => assistant("PRIVATE_OUTPUT", problem));
      }
      await f.rename();
      assert.equal(f.sm.getSessionName(), "Keep title");
      assert.equal(f.notices.at(-1)?.kind, "warning");
      assert.equal(f.statuses.at(-1), undefined);
      assert.doesNotMatch(JSON.stringify(f.notices), /PRIVATE_OUTPUT/);
    });
  }
});

test("timeout preserves title even when provider ignores abort", async () => {
  const f = fixture(10);
  await f.start();
  f.user();
  f.reply();
  f.api.setSessionName("Keep title");
  const pending = deferred<ReturnType<typeof assistant>>();
  f.setNext(() => pending.promise);
  await f.rename();
  assert.match(f.notices.at(-1)!.text, /timed out/);
  assert.equal(f.calls[0]!.options.signal.aborted, true);
  assert.equal(f.sm.getSessionName(), "Keep title");
  pending.resolve(assistant("Late title"));
  await tick();
  assert.equal(f.sm.getSessionName(), "Keep title");
  assert.equal(f.statuses.at(-1), undefined);
});

test("newest request wins and manual naming invalidates pending work", async () => {
  const f = fixture();
  await f.start();
  f.user();
  f.reply();
  const pending = deferred<ReturnType<typeof assistant>>();
  f.setNext(() => pending.promise);
  const old = f.rename();
  f.setNext(async () => assistant("Discovery: inspect retry ownership"));
  await f.rename();
  pending.resolve(assistant("Stale title"));
  await old;
  assert.equal(f.sm.getSessionName(), "Discovery: inspect retry ownership");
  assert.equal(f.calls[0]!.options.signal.aborted, true);

  const late = deferred<ReturnType<typeof assistant>>();
  f.setNext(() => late.promise);
  const run = f.rename();
  await f.rename("Manual title");
  late.resolve(assistant("Another stale title"));
  await run;
  assert.equal(f.sm.getSessionName(), "Manual title");
});

test("/name changes, including same-name changes, cancel pending requests", async () => {
  const f = fixture();
  await f.start();
  f.user();
  f.reply();
  f.api.setSessionName("Manual title");
  const pending = deferred<ReturnType<typeof assistant>>();
  f.setNext(() => pending.promise);
  const run = f.rename();
  f.api.setSessionName("Manual title");
  pending.resolve(assistant("Stale title"));
  await run;
  assert.equal(f.sm.getSessionName(), "Manual title");
});

test("session switch, tree navigation, shutdown and reload discard late results", async (t) => {
  for (const event of ["session_start", "session_tree", "session_shutdown"] as const) {
    await t.test(event, async () => {
      const f = fixture();
      await f.start();
      f.user();
      f.reply();
      const pending = deferred<ReturnType<typeof assistant>>();
      f.setNext(() => pending.promise);
      const run = f.rename();
      await f.emit(event, { reason: "resume" });
      pending.resolve(assistant("Stale title"));
      await run;
      assert.equal(f.sm.getSessionName(), undefined);
      assert.equal(f.statuses.at(-1), undefined);
    });
  }
});

test("busy rename waits, captures finished context, and cannot overwrite a newer command", async () => {
  const f = fixture();
  await f.start();
  f.user();
  const idle = deferred<void>();
  f.setBusy(() => idle.promise);
  const run = f.rename();
  assert.equal(f.calls.length, 0);
  f.reply();
  idle.resolve();
  await run;
  assert.match(f.calls[0]!.context.messages[0]!.content, /registration retry ownership/);

  const busy = deferred<void>();
  f.setBusy(() => busy.promise);
  const old = f.rename();
  await f.rename("Manual title");
  busy.resolve();
  await old;
  assert.equal(f.calls.length, 1);
  assert.equal(f.sm.getSessionName(), "Manual title");
});

test("normal new messages during generation do not invalidate the captured snapshot", async () => {
  const f = fixture();
  await f.start();
  f.user();
  f.reply();
  const pending = deferred<ReturnType<typeof assistant>>();
  f.setNext(() => pending.promise);
  const run = f.rename();
  f.user("A later question");
  assert.doesNotMatch(f.calls[0]!.context.messages[0]!.content, /A later question/);
  pending.resolve(assistant("Discovery: inspect registration retries"));
  await run;
  assert.equal(f.sm.getSessionName(), "Discovery: inspect registration retries");
});

test("real Pi projection respects edits, omissions, compaction and abandoned branches", async () => {
  const f = fixture();
  await f.start();
  const root = f.user("EXCLUDED_ORIGINAL");
  f.sm.appendContextEdit(root, { content: "Inspect retry ownership" });
  const removed = f.user("EXCLUDED_REMOVED");
  f.sm.appendContextEdit(removed, null);
  await f.rename();
  let input = f.calls.at(-1)!.context.messages[0]!.content;
  assert.match(input, /Inspect retry ownership/);
  assert.doesNotMatch(input, /EXCLUDED/);

  const branchPoint = f.sm.getLeafId()!;
  f.user("EXCLUDED_ABANDONED");
  f.sm.branch(branchPoint);
  f.user("Current branch investigates reconnects");
  await f.emit("session_tree");
  await f.rename();
  input = f.calls.at(-1)!.context.messages[0]!.content;
  assert.match(input, /Current branch/);
  assert.doesNotMatch(input, /EXCLUDED_ABANDONED/);

  f.sm.appendCompaction("Retry ownership spans reconnects", null, 1000);
  f.user("Confirm the summary finding");
  await f.rename();
  input = f.calls.at(-1)!.context.messages[0]!.content;
  assert.match(input, /Retry ownership spans reconnects/);
  assert.doesNotMatch(input, /Current branch/);
});

test("explicit rename works without UI and does not add conversation messages", async () => {
  const f = fixture();
  f.ctx.hasUI = false;
  f.ctx.mode = "json";
  await f.start();
  f.user();
  f.reply();
  const before = f.sm.buildSessionProjection().messages.length;
  await f.rename();
  assert.equal(f.notices.length, 0);
  assert.equal(f.statuses.length, 0);
  assert.equal(f.sm.buildSessionProjection().messages.length, before);
  assert.ok(f.sm.getSessionName());
});

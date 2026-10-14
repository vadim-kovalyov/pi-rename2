import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  convertToLlm,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionUIContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

test("real Pi session and naming request share a structured prefix and cache identity offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-rename2-continuation-"));
  let dispose: (() => void) | undefined;

  try {
    const runtime = await ModelRuntime.create({
      authPath: join(directory, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(directory, "models-store.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    // Fake credentials are confined to this temporary runtime. No provider is contacted.
    await runtime.setRuntimeApiKey("openai", "synthetic-test-key");
    const model = runtime.getModels("openai")[0];
    assert.ok(model);
    const calls: {
      context: Parameters<ModelRuntime["streamSimple"]>[1];
      options: Parameters<ModelRuntime["streamSimple"]>[2];
    }[] = [];
    runtime.streamSimple = (selected, context, options) => {
      calls.push({ context: structuredClone(context), options });
      const response = {
        role: "assistant" as const,
        content: [
          {
            type: "text" as const,
            text:
              calls.length === 1
                ? "Retry ownership may span reconnects."
                : "Registry: investigate reconnect retry ownership",
          },
        ],
        api: selected.api,
        provider: selected.provider,
        model: selected.id,
        stopReason: "stop" as const,
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
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "start", partial: response };
          yield { type: "done", reason: "stop", message: response };
        },
        result: async () => response,
      } as unknown as ReturnType<ModelRuntime["streamSimple"]>;
    };

    const settings = SettingsManager.inMemory({
      retry: { enabled: false },
      cacheWarming: "off",
      compaction: { enabled: false },
    });
    const loader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager: settings,
      additionalExtensionPaths: [fileURLToPath(new URL("../src/extension.ts", import.meta.url))],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const sm = SessionManager.inMemory(directory);
    const { session } = await createAgentSession({
      cwd: directory,
      agentDir: directory,
      modelRuntime: runtime,
      model,
      thinkingLevel: "minimal",
      sessionManager: sm,
      settingsManager: settings,
      resourceLoader: loader,
      noTools: "all",
    });
    dispose = () => session.dispose();
    const errors: string[] = [];
    await session.bindExtensions({
      mode: "tui",
      uiContext: {
        notify: (message: string, kind: string) => {
          if (kind === "warning" || kind === "error") {
            errors.push(message);
          }
        },
        setStatus: () => {},
      } as unknown as ExtensionUIContext,
      onError: (error) => {
        errors.push(error.error);
      },
    });
    await session.prompt(
      "Investigate duplicate registrations after a fictional worker reconnects.",
    );
    await tick();

    assert.deepEqual(errors, []);
    assert.equal(calls.length, 2);
    assert.equal(sm.getSessionName(), "Registry: investigate reconnect retry ownership");
    const main = calls[0]!;
    const naming = calls[1]!;
    assert.deepEqual(
      naming.context.messages.slice(0, main.context.messages.length),
      main.context.messages,
    );
    assert.equal(naming.context.messages.length, main.context.messages.length + 2);
    assert.equal(naming.context.messages.at(-2)!.role, "assistant");
    assert.equal(naming.options?.sessionId, main.options?.sessionId);
    assert.equal(naming.options?.sessionId, sm.getSessionId());
    assert.notEqual(naming.options?.cacheRetention, "none");
    assert.equal(naming.options?.transport, "sse");
    assert.equal(
      convertToLlm(sm.buildSessionProjection().messages).length,
      main.context.messages.length + 1,
    );

    const before = structuredClone(sm.buildSessionProjection().messages);
    await session.prompt("/rename");
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[2]!.context.messages.slice(0, -1), convertToLlm(before));
    assert.deepEqual(sm.buildSessionProjection().messages, before);
    assert.deepEqual(errors, []);
  } finally {
    dispose?.();
    await rm(directory, { recursive: true, force: true });
  }
});

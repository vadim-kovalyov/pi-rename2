import assert from "node:assert/strict";
import { test } from "node:test";
import { errorHint, failureDiagnostics } from "../src/diagnostics.ts";

test("provider errors produce fixed hints, not raw excerpts", async (t) => {
  const cases: [unknown, string, number | undefined][] = [
    [new Error("400 Invalid reasoning_effort: minimal"), "reasoning-option", 400],
    [new Error("Unsupported enable_thinking parameter"), "reasoning-option", undefined],
    [new Error("Thinking about the problem"), "unknown", undefined],
    [new Error("request exceeds the available context size"), "context-limit", undefined],
    [new Error("the request exceeds context size"), "context-limit", undefined],
    [new Error("Jinja template error: PRIVATE_INPUT"), "chat-template", undefined],
    [Object.assign(new Error("PRIVATE_TOKEN"), { status: 401 }), "authentication", 401],
    ["HTTP 403 PRIVATE_TOKEN", "authentication", 403],
    ["429 PRIVATE_TOKEN", "rate-limit", 429],
    ["503 PRIVATE_INPUT", "server-error", 503],
    ["400 PRIVATE_INPUT", "request-rejected", 400],
    [new Error("fetch failed", { cause: { code: "ECONNREFUSED" } }), "connection", undefined],
    [new Error("PRIVATE_INPUT 401"), "unknown", undefined],
    [{ status: "401 PRIVATE_TOKEN" }, "unknown", undefined],
    [{ status: 401.5 }, "unknown", undefined],
    [{ status: 999 }, "unknown", undefined],
    [undefined, "unknown", undefined],
  ];
  for (const [error, hint, status] of cases) {
    await t.test(hint, () => {
      assert.deepEqual(errorHint(error), { hint, status });
    });
  }
});

test("diagnostic summaries allowlist stop reasons and omit arbitrary response fields", () => {
  const summary = failureDiagnostics("provider-response", "PRIVATE_ERROR", 256, {
    stopReason: "PRIVATE_STOP\x1b[31m",
    content: [{ type: "text" }, { type: "thinking" }, { type: "PRIVATE_BLOCK" }],
  });
  assert.equal(
    summary,
    "Rename diagnostics: stage=provider-response; hint=unknown; reasoning=minimal; maxTokens=256; transport=sse; stop=unknown; textBlocks=1; thinkingBlocks=1.",
  );
  assert.equal(
    failureDiagnostics("preflight", new Error("PRIVATE_ERROR"), undefined, undefined),
    "Rename diagnostics: stage=preflight.",
  );
});

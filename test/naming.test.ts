import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conversationText,
  generatedTitle,
  literalTitle,
  MAX_CONTEXT_LENGTH,
  namingPrompt,
} from "../src/naming.ts";

test("conversation uses only chat text and compaction summaries", () => {
  const text = conversationText([
    { role: "system", content: "EXCLUDED_SYSTEM" },
    {
      role: "user",
      content: [
        { type: "text", text: "Investigate discovery retries" },
        { type: "image", data: "EXCLUDED_IMAGE" },
      ],
    },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "EXCLUDED_REASONING" },
        { type: "toolCall", name: "EXCLUDED_TOOL" },
        { type: "text", text: "The retry budget may be exhausted" },
      ],
    },
    { role: "toolResult", content: "EXCLUDED_OUTPUT" },
    { role: "custom", content: "EXCLUDED_CUSTOM" },
    { role: "branchSummary", summary: "EXCLUDED_BRANCH" },
    { role: "compactionSummary", summary: "Earlier investigation ruled out DNS" },
  ]);
  assert.match(text, /Investigate discovery retries/);
  assert.match(text, /retry budget/);
  assert.match(text, /Earlier investigation/);
  assert.doesNotMatch(text, /EXCLUDED/);
});

test("long conversations preserve opening, sampled middle, recent text, and ordering", () => {
  const messages = Array.from({ length: 90 }, (_, index) => ({
    role: "user",
    content: `TURN_${String(index).padStart(3, "0")}: ${"x".repeat(1000)}`,
  }));
  const text = conversationText(messages);
  assert.ok(text.length <= MAX_CONTEXT_LENGTH);
  assert.match(text, /TURN_000/);
  assert.match(text, /TURN_089/);
  assert.match(text, /Conversation text omitted/);
  const turns = [...text.matchAll(/TURN_(\d+)/g)].map((match) => Number(match[1]));
  assert.deepEqual(
    turns,
    [...new Set(turns)].sort((a, b) => a - b),
  );
  assert.ok(turns.some((turn) => turn > 30 && turn < 60));
});

test("middle compaction summaries are prioritized and input stays bounded", () => {
  const text = conversationText([
    { role: "user", content: "opening ".repeat(2000) },
    {
      role: "compactionSummary",
      summary: `KEY_FINDING retry state persists across reconnects ${"s".repeat(20000)}`,
    },
    { role: "assistant", content: "recent ".repeat(4000) },
  ]);
  assert.match(text, /KEY_FINDING/);
  assert.ok(text.length <= MAX_CONTEXT_LENGTH);
});

test("many summaries remain bounded without duplicate or reordered ranges", () => {
  const messages = Array.from({ length: 100 }, (_, index) => ({
    role: "compactionSummary",
    summary: `SUMMARY_${index}: ${"s".repeat(400)}`,
  }));
  assert.ok(conversationText(messages).length <= MAX_CONTEXT_LENGTH);
});

test("prompt separates untrusted data and asks for whole-session specificity and variety", () => {
  const prompt = namingPrompt(
    "Investigate retries",
    "Retry investigation",
    ["one", "two", "three", "four", "five", "six"],
    "sample-project",
  );
  const input = JSON.parse(prompt.input);
  assert.deepEqual(input.previousTitles, ["two", "three", "four", "five", "six"]);
  assert.equal(input.currentTitle, "Retry investigation");
  assert.match(prompt.systemPrompt, /whole-session theme/);
  assert.match(prompt.systemPrompt, /meaningfully different/);
  assert.match(prompt.systemPrompt, /untrusted data/);
  assert.match(prompt.systemPrompt, /Do not claim a fix/);
});

test("generated titles normalize quotes, whitespace, ASCII, and length", () => {
  assert.equal(
    generatedTitle(' "Discovery:  explore\nretry timing" '),
    "Discovery: explore retry timing",
  );
  assert.equal(generatedTitle("Caf\u00e9 \u2014 retry behavior"), "Cafe - retry behavior");
  assert.ok(generatedTitle(`Investigate ${"worker cancellation ".repeat(20)}`).length <= 80);
  assert.equal(generatedTitle("x".repeat(100)).length, 80);
  assert.throws(() => generatedTitle("\u001b\u0000"), /invalid-title/);
  assert.throws(() => generatedTitle("---"), /invalid-title/);
});

test("clipped generated titles do not end in a dangling connector", () => {
  const title = generatedTitle(
    "Investigating Duplicate Device Registrations and Retry Ownership Across Reconnecting Workers",
  );
  assert.equal(title, "Investigating Duplicate Device Registrations and Retry Ownership");
  assert.equal(
    generatedTitle("Compare retries across reconnects"),
    "Compare retries across reconnects",
  );
});

test("literal titles preserve wording and length but reject controls", () => {
  assert.equal(literalTitle("  My exact title  "), "My exact title");
  assert.equal(literalTitle("x".repeat(120)).length, 120);
  for (const title of [
    "two\nlines",
    "tab\there",
    "escape\u001b[31m",
    "delete\u007f",
    "break\u2028line",
  ]) {
    assert.throws(() => literalTitle(title), /invalid-literal/);
  }
});

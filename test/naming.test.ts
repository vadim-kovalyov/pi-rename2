import assert from "node:assert/strict";
import { test } from "node:test";
import { generatedTitle, literalTitle, namingPrompt, textContent } from "../src/naming.ts";

test("text extraction includes only visible response text", () => {
  assert.equal(textContent("A title"), "A title");
  assert.equal(textContent(null), "");
  assert.equal(
    textContent([
      { type: "text", text: "Discovery:" },
      { type: "thinking", thinking: "EXCLUDED_REASONING" },
      { type: "toolCall", name: "EXCLUDED_TOOL" },
      { type: "image", data: "EXCLUDED_IMAGE" },
      { type: "text", text: "investigate retries" },
    ]),
    "Discovery:\ninvestigate retries",
  );
});

test("temporary instruction requests only a specific whole-session title and treats metadata as data", () => {
  const prompt = namingPrompt(
    "Retry investigation",
    ["one", "two", "three", "four", "five", "six"],
    "sample-project",
  );
  const input = JSON.parse(prompt.split("\n").at(-1)!);
  assert.deepEqual(input.previousTitles, ["two", "three", "four", "five", "six"]);
  assert.equal(input.currentTitle, "Retry investigation");
  assert.match(prompt, /whole-session theme/);
  assert.match(prompt, /meaningfully different/);
  assert.match(prompt, /untrusted data/);
  assert.match(prompt, /Do not invent identifiers or claim a fix/);
  assert.match(prompt, /Do not use tools/);
  assert.match(prompt, /instead of continuing its work/);
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

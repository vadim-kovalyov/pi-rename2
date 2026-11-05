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

test("naming prompt forbids tools and ends with untrusted metadata", () => {
  const prompt = namingPrompt(
    "Retry investigation",
    ["one", "two", "three", "four", "five", "six"],
    "sample-project",
  );
  const lines = prompt.split("\n");
  assert.deepEqual(JSON.parse(lines.at(-1)!), {
    directoryHint: "sample-project",
    currentTitle: "Retry investigation",
    previousTitles: ["two", "three", "four", "five", "six"],
  });
  assert.match(lines.at(-2)!, /untrusted data/);
  assert.match(prompt, /Do not use tools/);
  assert.equal(JSON.parse(namingPrompt(undefined, [], "x").split("\n").at(-1)!).currentTitle, null);
});

test("generated titles normalize quotes, whitespace, controls, and length", () => {
  assert.equal(
    generatedTitle(' "Discovery:  explore\nretry timing" '),
    "Discovery: explore retry timing",
  );
  assert.equal(
    generatedTitle("Caf\u00e9 \u2014 retry behavior"),
    "Caf\u00e9 \u2014 retry behavior",
  );
  assert.equal(generatedTitle("Cafe\u0301"), "Caf\u00e9");
  assert.equal(generatedTitle("Retry \u202eownership\u202c"), "Retry ownership");
  assert.equal(generatedTitle("x".repeat(100))?.length, 80);
  assert.equal(generatedTitle("\u001b\u0000"), undefined);
  assert.equal(generatedTitle("---"), undefined);
});

test("long generated titles clip at a word boundary", () => {
  assert.equal(
    generatedTitle(
      "Investigating Duplicate Device Registrations and Retry Ownership Across Reconnecting Workers",
    ),
    "Investigating Duplicate Device Registrations and Retry Ownership Across",
  );
  assert.equal(generatedTitle(`${"a".repeat(70)} - ${"b".repeat(20)}`), "a".repeat(70));
});

test("generated titles preserve the session language and count Unicode code points", () => {
  for (const title of [
    "\u041f\u043e\u0432\u0442\u043e\u0440\u043d\u0430\u044f \u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0430\u0446\u0438\u044f",
    "\u6392\u67e5\u91cd\u590d\u6ce8\u518c",
    "\u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u062a\u0633\u062c\u064a\u0644",
    "\u0915\u094d\u200d\u0937",
  ]) {
    assert.equal(generatedTitle(title), title);
  }

  assert.equal(generatedTitle("\u{10400}".repeat(100)), "\u{10400}".repeat(80));
  assert.equal(Array.from(generatedTitle("\u6ce8".repeat(100))!).length, 80);
});

test("literal titles preserve wording and length but reject controls", () => {
  assert.equal(literalTitle("  My exact title  "), "My exact title");
  assert.equal(literalTitle("x".repeat(120))?.length, 120);
  for (const title of [
    "two\nlines",
    "tab\there",
    "escape\u001b[31m",
    "delete\u007f",
    "break\u2028line",
    "bidi\u202eoverride",
  ]) {
    assert.equal(literalTitle(title), undefined);
  }
});

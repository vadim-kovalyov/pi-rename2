import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

test("Pi loads the extension in place without personal settings or provider requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-rename2-test-"));
  try {
    const loader = new DefaultResourceLoader({
      cwd: directory,
      agentDir: directory,
      settingsManager: SettingsManager.inMemory(),
      additionalExtensionPaths: [fileURLToPath(new URL("../src/extension.ts", import.meta.url))],
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    assert.deepEqual(loaded.warnings ?? [], []);
    const extension = loaded.extensions.find((value) => value.commands.has("rename"));
    assert.ok(extension);
    assert.deepEqual([...extension.commands.keys()], ["rename"]);
    assert.equal(extension.tools.size, 0);
    assert.ok(extension.handlers.has("agent_settled"));
    assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "CanvasApp.tsx");
const source = await readFile(sourcePath, "utf8");

test("hides the Codex login action from the provider status popover in hosted AI Cove mode", () => {
  assert.match(source, /showCodexAuthAction/u, "ProviderStatusPopover should receive an explicit Codex action visibility flag");
  assert.match(source, /showCodexAuthAction=\{!isAiCoveMode\}/u, "Hosted AI Cove mode should disable the Codex login action");
  assert.match(source, /showCodexAuthAction \? \(/u, "ProviderStatusPopover should gate the login button behind the visibility flag");
});

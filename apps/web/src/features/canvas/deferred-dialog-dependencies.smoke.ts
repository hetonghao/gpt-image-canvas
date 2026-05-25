import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const canvasAppSource = await readFile(path.join(currentDir, "CanvasApp.tsx"), "utf8");

assert.ok(
  !canvasAppSource.includes('import { AgentSkillDialog } from "../agent/AgentSkillDialog";'),
  "AgentSkillDialog should not be statically imported into the canvas startup bundle"
);
assert.ok(
  !canvasAppSource.includes('import { ProviderConfigDialog } from "../provider-config/ProviderConfigDialog";'),
  "ProviderConfigDialog should not be statically imported into the canvas startup bundle"
);
assert.ok(
  canvasAppSource.includes('import("../agent/AgentSkillDialog")'),
  "AgentSkillDialog should be loaded only when the dialog opens"
);
assert.ok(
  canvasAppSource.includes('import("../provider-config/ProviderConfigDialog")'),
  "ProviderConfigDialog should be loaded only when the dialog opens"
);

process.stdout.write("deferred-dialog-dependencies.smoke.ts passed\n");

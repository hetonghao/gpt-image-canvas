import assert from "node:assert/strict";
import path from "node:path";
import { apiDeployArgs, nodeStripArgs, promptPoolResourcePaths } from "./desktop-prepare-sidecar.mjs";

const args = apiDeployArgs("/tmp/ai-cove-design-sidecar-api");

assert.deepEqual(args, [
  "--filter",
  "@gpt-image-canvas/api",
  "deploy",
  "--prod",
  "--config.node-linker=hoisted",
  "/tmp/ai-cove-design-sidecar-api"
]);

assert.deepEqual(nodeStripArgs("/tmp/node", "darwin"), ["-x", "/tmp/node"]);
assert.equal(nodeStripArgs("/tmp/node", "win32"), null);

assert.deepEqual(promptPoolResourcePaths("/tmp/ai-cove-design"), {
  source: path.join("/tmp/ai-cove-design", "prompt-pool-data"),
  target: path.join("/tmp/ai-cove-design", "src-tauri", "resources", "sidecar", "prompt-pool-data")
});

process.stdout.write("desktop-prepare-sidecar.test.mjs passed\n");

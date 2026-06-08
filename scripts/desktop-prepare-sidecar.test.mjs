import assert from "node:assert/strict";
import { apiDeployArgs, nodeStripArgs } from "./desktop-prepare-sidecar.mjs";

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

process.stdout.write("desktop-prepare-sidecar.test.mjs passed\n");

import assert from "node:assert/strict";
import { apiDeployArgs } from "./desktop-prepare-sidecar.mjs";

const args = apiDeployArgs("/tmp/ai-cove-design-sidecar-api");

assert.deepEqual(args, [
  "--filter",
  "@gpt-image-canvas/api",
  "deploy",
  "--prod",
  "--config.node-linker=hoisted",
  "/tmp/ai-cove-design-sidecar-api"
]);

process.stdout.write("desktop-prepare-sidecar.test.mjs passed\n");

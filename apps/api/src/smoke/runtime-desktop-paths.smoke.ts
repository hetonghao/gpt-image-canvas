import assert from "node:assert/strict";

process.env.DATA_DIR = "/tmp/ai-cove-design-data";
process.env.AI_COVE_DESIGN_WEB_DIST_DIR = "/tmp/ai-cove-design-web-dist";

const { runtimePaths } = await import("../infrastructure/runtime.js");

assert.equal(runtimePaths.dataDir, "/tmp/ai-cove-design-data");
assert.equal(runtimePaths.webDistDir, "/tmp/ai-cove-design-web-dist");

process.stdout.write("runtime-desktop-paths.smoke.ts passed\n");

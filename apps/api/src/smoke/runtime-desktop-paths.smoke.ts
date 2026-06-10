import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.DATA_DIR = "/tmp/ai-cove-design-data";
process.env.AI_COVE_DESIGN_WEB_DIST_DIR = "/tmp/ai-cove-design-web-dist";

const { runtimePaths } = await import("../infrastructure/runtime.js");
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const tauriMainSource = await readFile(path.resolve(currentDir, "../../../../src-tauri/src/main.rs"), "utf8");

assert.equal(runtimePaths.dataDir, "/tmp/ai-cove-design-data");
assert.equal(runtimePaths.webDistDir, "/tmp/ai-cove-design-web-dist");
assert.match(tauriMainSource, /std::thread::spawn/u, "desktop sidecar startup should run on a background thread so the window can paint");
assert.match(tauriMainSource, /\.stdout\(Stdio::from/u, "desktop sidecar stdout should be persisted to a log file");
assert.match(tauriMainSource, /\.stderr\(Stdio::from/u, "desktop sidecar stderr should be persisted to a log file");

process.stdout.write("runtime-desktop-paths.smoke.ts passed\n");

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
assert.match(tauriMainSource, /CREATE_NO_WINDOW/u, "desktop sidecar should hide the Windows node console window");
assert.match(tauriMainSource, /\.creation_flags\(CREATE_NO_WINDOW\)/u, "desktop sidecar should apply the Windows no-window creation flag");
assert.match(tauriMainSource, /fn prepare_desktop_update_install/u, "desktop updater should expose a command that releases sidecar file locks before install");
assert.match(tauriMainSource, /stop_api_sidecar\(&handle\)/u, "desktop update preparation should stop the API sidecar");
assert.match(tauriMainSource, /generate_handler!\[prepare_desktop_update_install\]/u, "desktop update preparation command should be registered");

process.stdout.write("runtime-desktop-paths.smoke.ts passed\n");

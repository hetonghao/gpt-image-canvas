import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const canvasAppSource = await readFile(join(currentDir, "../../features/canvas/CanvasApp.tsx"), "utf8");

assert.match(canvasAppSource, /useDesktopUpdater/u, "CanvasApp should use the shared desktop updater hook");
assert.match(canvasAppSource, /DesktopUpdateDialog/u, "CanvasApp should render the shared desktop update dialog");
assert.match(canvasAppSource, /onCheckDesktopUpdate/u, "TopNavigation should receive a desktop update action");
assert.doesNotMatch(canvasAppSource, /AppDesktop/u, "desktop should not fork a separate AppDesktop feature shell");

process.stdout.write("desktop-update-integration.smoke.ts passed\n");

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const canvasAppSource = await readFile(join(currentDir, "../../features/canvas/CanvasApp.tsx"), "utf8");
const dialogSource = await readFile(join(currentDir, "DesktopUpdateDialog.tsx"), "utf8");

assert.match(canvasAppSource, /useDesktopUpdater/u, "CanvasApp should use the shared desktop updater hook");
assert.match(canvasAppSource, /DesktopUpdateDialog/u, "CanvasApp should render the shared desktop update dialog");
assert.match(canvasAppSource, /onCheckDesktopUpdate/u, "TopNavigation should receive a desktop update action");
assert.doesNotMatch(canvasAppSource, /AppDesktop/u, "desktop should not fork a separate AppDesktop feature shell");
assert.match(dialogSource, /useModalFocus/u, "Desktop update dialog should use the shared modal focus contract");
assert.match(dialogSource, /createPortal/u, "Desktop update dialog should stay outside the inert app root");
assert.match(dialogSource, /ref=\{dialogRef\}/u, "Desktop update dialog should attach modal focus to the dialog surface");

process.stdout.write("desktop-update-integration.smoke.ts passed\n");

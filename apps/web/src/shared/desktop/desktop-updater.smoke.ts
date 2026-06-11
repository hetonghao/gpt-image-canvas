import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const {
  desktopUpdateProgressFromBytes,
  desktopUpdateProgressLabel,
  desktopUpdaterDialogState,
  formatDesktopUpdateBytes,
  initialDesktopUpdaterState
} = await import("./desktop-updater.js");
const currentDir = dirname(fileURLToPath(import.meta.url));
const updaterSource = await readFile(join(currentDir, "desktop-updater.ts"), "utf8");
const hookSource = await readFile(join(currentDir, "useDesktopUpdater.ts"), "utf8");
const dialogSource = await readFile(join(currentDir, "DesktopUpdateDialog.tsx"), "utf8");

assert.deepEqual(desktopUpdateProgressFromBytes(25, 100), {
  downloadedBytes: 25,
  totalBytes: 100,
  percent: 25
});

assert.deepEqual(desktopUpdateProgressFromBytes(25, null), {
  downloadedBytes: 25,
  totalBytes: null,
  percent: null
});

assert.deepEqual(desktopUpdaterDialogState(initialDesktopUpdaterState), {
  status: "idle",
  currentVersion: null,
  availableVersion: null,
  notes: null,
  publishedAt: null,
  downloadedBytes: null,
  totalBytes: null,
  progressPercent: null,
  error: null,
  message: null,
  isOpen: false
});

assert.equal(formatDesktopUpdateBytes(1536), "1.5 KB");
assert.equal(desktopUpdateProgressLabel(1536, null), "1.5 KB");
assert.equal(desktopUpdateProgressLabel(1536, 4096), "1.5 KB / 4.0 KB");

assert.match(updaterSource, /prepareRelaunch:\s*\(\)\s*=>\s*Promise<void>/u, "Desktop updater adapter should expose a relaunch preloader");
assert.ok(updaterSource.includes("let desktopRelaunchLoader: Promise<() => Promise<void>> | null = null;"), "Desktop updater should cache the relaunch loader");
assert.match(updaterSource, /invoke<void>\("prepare_desktop_update_install"\)/u, "Desktop updater should stop the sidecar before installing an update");
assert.match(hookSource, /status:\s*"installing"/u, "Install flow should enter an installing state");
assert.match(hookSource, /await adapter\.prepareRelaunch\(\);\s*await availableUpdate\.install\(\);\s*await adapter\.relaunch\(\);/u, "Install flow should preload relaunch and restart immediately after install");
assert.ok(!hookSource.includes('status: "installed"'), "Install flow should not do an extra installed-state render after updater assets are swapped");
assert.match(dialogSource, /state\.status === "checking" \|\| state\.status === "downloading" \|\| state\.status === "installing"/u, "Updater dialog should treat installing as a busy state");
assert.ok(dialogSource.includes("animate-pulse"), "Updater dialog should show an indeterminate bar when total bytes are unknown");
assert.match(dialogSource, /shouldShowProgress/u, "Updater dialog should keep rendering the progress section during downloading and installing");

process.stdout.write("desktop-updater.smoke.ts passed\n");

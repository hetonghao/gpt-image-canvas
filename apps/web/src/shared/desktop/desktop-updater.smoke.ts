import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { desktopUpdateProgressFromBytes, desktopUpdaterDialogState, initialDesktopUpdaterState } = await import("./desktop-updater.js");
const currentDir = dirname(fileURLToPath(import.meta.url));
const updaterSource = await readFile(join(currentDir, "desktop-updater.ts"), "utf8");
const hookSource = await readFile(join(currentDir, "useDesktopUpdater.ts"), "utf8");

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
  progressPercent: null,
  error: null,
  message: null,
  isOpen: false
});

assert.match(updaterSource, /prepareRelaunch:\s*\(\)\s*=>\s*Promise<void>/u, "Desktop updater adapter should expose a relaunch preloader");
assert.ok(updaterSource.includes("let desktopRelaunchLoader: Promise<() => Promise<void>> | null = null;"), "Desktop updater should cache the relaunch loader");
assert.match(hookSource, /await adapter\.prepareRelaunch\(\);\s*await availableUpdate\.install\(\);/u, "Install flow should preload relaunch before updater install swaps app assets");

process.stdout.write("desktop-updater.smoke.ts passed\n");

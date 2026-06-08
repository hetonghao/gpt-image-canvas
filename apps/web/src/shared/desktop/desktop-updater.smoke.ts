import assert from "node:assert/strict";

const { desktopUpdateProgressFromBytes, desktopUpdaterDialogState, initialDesktopUpdaterState } = await import("./desktop-updater.js");

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

process.stdout.write("desktop-updater.smoke.ts passed\n");

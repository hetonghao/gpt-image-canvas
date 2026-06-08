import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateDesktopRelease } from "./desktop-release-validation.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ai-cove-design-validate-"));
const releaseDir = path.join(tempRoot, "desktop-release");

await import("node:fs/promises").then(({ mkdir }) => mkdir(releaseDir, { recursive: true }));
await writeFile(path.join(releaseDir, "latest.json"), JSON.stringify({
  version: "0.2.0",
  platforms: {
    "darwin-aarch64": {
      signature: "mac-signature",
      url: "https://ai-cove.com/downloads/ai-cove-design-desktop-macos-aarch64.app.tar.gz"
    },
    "windows-x86_64": {
      signature: "windows-signature",
      url: "https://ai-cove.com/downloads/ai-cove-design-desktop-windows-x86_64.nsis.zip"
    }
  }
}, null, 2));
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-macos.dmg"), "mac installer");
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-windows.exe"), "windows installer");
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-macos-aarch64.app.tar.gz"), "mac updater");
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-macos-aarch64.app.tar.gz.sig"), "mac-signature");
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-windows-x86_64.nsis.zip"), "windows updater");
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-windows-x86_64.nsis.zip.sig"), "windows-signature");

const valid = await validateDesktopRelease({
  releaseDir,
  requiredPlatforms: ["darwin-aarch64", "windows-x86_64"]
});
assert.deepEqual(valid, {
  platforms: ["darwin-aarch64", "windows-x86_64"],
  version: "0.2.0"
});

await writeFile(path.join(releaseDir, "latest.json"), JSON.stringify({
  version: "0.2.0",
  platforms: {
    "darwin-aarch64": {
      signature: "mac-signature",
      url: "https://ai-cove.com/downloads/ai-cove-design-desktop-macos-aarch64.app.tar.gz"
    }
  }
}, null, 2));

await assert.rejects(
  () => validateDesktopRelease({
    releaseDir,
    requiredPlatforms: ["darwin-aarch64", "windows-x86_64"]
  }),
  /missing updater platform: windows-x86_64/u
);

await rm(tempRoot, { force: true, recursive: true });

process.stdout.write("desktop-validate-release.test.mjs passed\n");

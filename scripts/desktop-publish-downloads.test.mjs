import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncDesktopDownloads } from "./desktop-publish-downloads.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ai-cove-design-downloads-"));
const releaseDir = path.join(tempRoot, "desktop-release");
const downloadsDir = path.join(tempRoot, "downloads");

const validMacManifest = {
  version: "0.2.0",
  platforms: {
    "darwin-aarch64": {
      signature: "mac-signature",
      url: "https://ai-cove.com/downloads/ai-cove-design-desktop-macos-aarch64.app.tar.gz"
    }
  }
};

await writeFile(path.join(releaseDir, "latest.json"), JSON.stringify(validMacManifest, null, 2), { flag: "wx" }).catch(async (error) => {
  if (error.code !== "ENOENT") throw error;
  await import("node:fs/promises").then(({ mkdir }) => mkdir(releaseDir, { recursive: true }));
  await writeFile(path.join(releaseDir, "latest.json"), JSON.stringify(validMacManifest, null, 2));
});
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-macos.dmg"), "mac installer");
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-macos-aarch64.app.tar.gz"), "mac updater");
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-macos-aarch64.app.tar.gz.sig"), "mac-signature");

const copied = await syncDesktopDownloads({ releaseDir, downloadsDir });

assert.deepEqual(copied, [
  "ai-cove-design-desktop-macos-aarch64.app.tar.gz",
  "ai-cove-design-desktop-macos-aarch64.app.tar.gz.sig",
  "ai-cove-design-desktop-macos.dmg",
  "latest.json"
]);
assert.equal(await readFile(path.join(downloadsDir, "ai-cove-design-desktop-macos.dmg"), "utf8"), "mac installer");
assert.deepEqual(JSON.parse(await readFile(path.join(downloadsDir, "latest.json"), "utf8")), validMacManifest);

await rm(releaseDir, { force: true, recursive: true });
await import("node:fs/promises").then(({ mkdir }) => mkdir(releaseDir, { recursive: true }));
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-macos.dmg"), "mac installer");

await assert.rejects(
  () => syncDesktopDownloads({ releaseDir, downloadsDir }),
  /missing desktop release artifact: latest\.json/u
);

await writeFile(path.join(releaseDir, "latest.json"), JSON.stringify({
  version: "0.2.0",
  platforms: {
    "darwin-aarch64": {
      signature: "",
      url: "https://ai-cove.com/downloads/ai-cove-design-desktop-macos-aarch64.app.tar.gz"
    }
  }
}));
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-macos.dmg"), "mac installer");
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-macos-aarch64.app.tar.gz"), "mac updater");
await writeFile(path.join(releaseDir, "ai-cove-design-desktop-macos-aarch64.app.tar.gz.sig"), "mac-signature");

await assert.rejects(
  () => syncDesktopDownloads({ releaseDir, downloadsDir }),
  /missing updater signature for darwin-aarch64/u
);

await rm(tempRoot, { force: true, recursive: true });

process.stdout.write("desktop-publish-downloads.test.mjs passed\n");

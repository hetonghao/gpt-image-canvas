import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleDesktopRelease } from "./desktop-assemble-release.mjs";

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ai-cove-design-assemble-"));
const inputRoot = path.join(tempRoot, "input");
const macDir = path.join(inputRoot, "macos");
const windowsDir = path.join(inputRoot, "windows");
const outputDir = path.join(tempRoot, "output");

await import("node:fs/promises").then(({ mkdir }) => mkdir(macDir, { recursive: true }));
await import("node:fs/promises").then(({ mkdir }) => mkdir(windowsDir, { recursive: true }));

await writeJson(path.join(macDir, "latest.json"), {
  version: "0.2.0",
  notes: "AI-Cove-Design 0.2.0",
  pub_date: "2026-06-08T00:00:00.000Z",
  platforms: {
    "darwin-aarch64": {
      signature: "mac-signature",
      url: "https://ai-cove.com/downloads/ai-cove-design-desktop-macos-aarch64.app.tar.gz"
    }
  }
});
await writeFile(path.join(macDir, "ai-cove-design-desktop-macos.dmg"), "mac installer");
await writeFile(path.join(macDir, "ai-cove-design-desktop-macos-aarch64.app.tar.gz"), "mac updater");
await writeFile(path.join(macDir, "ai-cove-design-desktop-macos-aarch64.app.tar.gz.sig"), "mac signature");

await writeJson(path.join(windowsDir, "latest.json"), {
  version: "0.2.0",
  notes: "AI-Cove-Design 0.2.0",
  pub_date: "2026-06-08T00:00:01.000Z",
  platforms: {
    "windows-x86_64": {
      signature: "windows-signature",
      url: "https://ai-cove.com/downloads/ai-cove-design-desktop-windows-x86_64.nsis.zip"
    }
  }
});
await writeFile(path.join(windowsDir, "ai-cove-design-desktop-windows.exe"), "windows installer");
await writeFile(path.join(windowsDir, "ai-cove-design-desktop-windows-x86_64.nsis.zip"), "windows updater");
await writeFile(path.join(windowsDir, "ai-cove-design-desktop-windows-x86_64.nsis.zip.sig"), "windows signature");

const assembled = await assembleDesktopRelease({ inputRoot, outputDir });
assert.deepEqual(assembled.platforms, ["darwin-aarch64", "windows-x86_64"]);
assert.deepEqual(assembled.artifacts, [
  "ai-cove-design-desktop-macos-aarch64.app.tar.gz",
  "ai-cove-design-desktop-macos-aarch64.app.tar.gz.sig",
  "ai-cove-design-desktop-macos.dmg",
  "ai-cove-design-desktop-windows-x86_64.nsis.zip",
  "ai-cove-design-desktop-windows-x86_64.nsis.zip.sig",
  "ai-cove-design-desktop-windows.exe"
]);

const mergedManifest = JSON.parse(await readFile(path.join(outputDir, "latest.json"), "utf8"));
assert.equal(mergedManifest.version, "0.2.0");
assert.deepEqual(Object.keys(mergedManifest.platforms).sort(), ["darwin-aarch64", "windows-x86_64"]);
assert.equal(await readFile(path.join(outputDir, "ai-cove-design-desktop-windows.exe"), "utf8"), "windows installer");

const mismatchDir = path.join(inputRoot, "mismatch");
await import("node:fs/promises").then(({ mkdir }) => mkdir(mismatchDir, { recursive: true }));
await writeJson(path.join(mismatchDir, "latest.json"), {
  version: "0.3.0",
  notes: "AI-Cove-Design 0.3.0",
  pub_date: "2026-06-08T00:00:02.000Z",
  platforms: {
    "linux-x86_64": {
      signature: "linux-signature",
      url: "https://ai-cove.com/downloads/linux.tar.gz"
    }
  }
});

await assert.rejects(
  () => assembleDesktopRelease({ inputRoot, outputDir: path.join(tempRoot, "mismatch-output") }),
  /manifest version mismatch/u
);

await rm(mismatchDir, { force: true, recursive: true });
const duplicateDir = path.join(inputRoot, "duplicate");
await import("node:fs/promises").then(({ mkdir }) => mkdir(duplicateDir, { recursive: true }));
await writeJson(path.join(duplicateDir, "latest.json"), {
  version: "0.2.0",
  notes: "AI-Cove-Design 0.2.0",
  pub_date: "2026-06-08T00:00:02.000Z",
  platforms: {
    "darwin-aarch64": {
      signature: "duplicate-mac-signature",
      url: "https://ai-cove.com/downloads/duplicate.tar.gz"
    }
  }
});

await assert.rejects(
  () => assembleDesktopRelease({ inputRoot, outputDir: path.join(tempRoot, "duplicate-output") }),
  /duplicate updater platform/u
);

const workflow = await readFile(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "desktop-release.yml"),
  "utf8"
);
assert.match(workflow, /windows-latest/u);
assert.match(workflow, /macos-14/u);
assert.match(workflow, /desktop:assemble-release/u);

await rm(tempRoot, { force: true, recursive: true });

process.stdout.write("desktop-assemble-release.test.mjs passed\n");

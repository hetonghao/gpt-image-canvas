import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildLatestManifest,
  mergeLatestManifest,
  releaseArtifactNames,
  resolveMacSigningIdentity,
  tauriBuildEnvironment
} from "./desktop-build.mjs";

assert.deepEqual(releaseArtifactNames("darwin", "arm64"), {
  installer: "ai-cove-design-desktop-macos.dmg",
  updaterArchive: "ai-cove-design-desktop-macos-aarch64.app.tar.gz",
  updaterSignature: "ai-cove-design-desktop-macos-aarch64.app.tar.gz.sig",
  updaterPlatform: "darwin-aarch64"
});

assert.deepEqual(releaseArtifactNames("win32", "x64"), {
  installer: "ai-cove-design-desktop-windows.exe",
  updaterArchive: "ai-cove-design-desktop-windows.exe",
  updaterSignature: "ai-cove-design-desktop-windows.exe.sig",
  updaterPlatform: "windows-x86_64"
});

const tauriConfig = JSON.parse(await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const defaultCapability = JSON.parse(await readFile(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
assert.equal(tauriConfig.productName, "AI Cove Design", "desktop app display name should use AI Cove Design");
assert.equal(tauriConfig.app?.windows?.[0]?.title, "AI Cove Design", "desktop window title should use AI Cove Design");
assert.ok(
  tauriConfig.bundle?.targets?.includes("nsis"),
  "Windows desktop release requires the Tauri NSIS bundle target"
);
assert.deepEqual(
  tauriConfig.bundle?.icon,
  [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ],
  "desktop release must package the AI Cove Design icon"
);
assert.deepEqual(
  defaultCapability.remote?.urls,
  ["http://127.0.0.1:*", "http://localhost:*"],
  "desktop sidecar origin must be allowed to use Tauri opener permissions"
);

assert.equal(resolveMacSigningIdentity({}), "-", "macOS release should default to ad-hoc app signing");
assert.equal(
  resolveMacSigningIdentity({ APPLE_SIGNING_IDENTITY: "Developer ID Application: Example" }),
  "Developer ID Application: Example",
  "explicit macOS signing identities must be preserved"
);
assert.equal(
  tauriBuildEnvironment({ TAURI_SIGNING_PRIVATE_KEY: "key" }, "darwin").APPLE_SIGNING_IDENTITY,
  "-",
  "macOS Tauri builds must receive an app signing identity"
);
assert.deepEqual(
  tauriBuildEnvironment({ TAURI_SIGNING_PRIVATE_KEY: "key" }, "linux"),
  { TAURI_SIGNING_PRIVATE_KEY: "key" },
  "non-macOS Tauri builds should not receive macOS signing env"
);

assert.deepEqual(
  buildLatestManifest({
    version: "0.2.0",
    downloadBaseUrl: "https://ai-cove.com/downloads/",
    notes: "AI Cove Design desktop update",
    publishedAt: "2026-06-08T00:00:00.000Z",
    platforms: [
      {
        platform: "darwin-aarch64",
        signature: "mac-signature",
        updaterArchiveName: "ai-cove-design-desktop-macos-aarch64.app.tar.gz"
      }
    ]
  }),
  {
    version: "0.2.0",
    notes: "AI Cove Design desktop update",
    pub_date: "2026-06-08T00:00:00.000Z",
    platforms: {
      "darwin-aarch64": {
        signature: "mac-signature",
        url: "https://ai-cove.com/downloads/ai-cove-design-desktop-macos-aarch64.app.tar.gz?v=0.2.0"
      }
    }
  }
);

assert.deepEqual(
  mergeLatestManifest(
    {
      version: "0.1.9",
      notes: "old notes",
      pub_date: "2026-06-07T00:00:00.000Z",
      platforms: {
        "windows-x86_64": {
          signature: "windows-signature",
          url: "https://ai-cove.com/downloads/ai-cove-design-desktop-windows.exe?v=0.1.9"
        }
      }
    },
    buildLatestManifest({
      version: "0.2.0",
      downloadBaseUrl: "https://ai-cove.com/downloads",
      notes: "AI Cove Design 0.2.0",
      publishedAt: "2026-06-08T00:00:00.000Z",
      platforms: [
        {
          platform: "darwin-aarch64",
          signature: "mac-signature",
          updaterArchiveName: "ai-cove-design-desktop-macos-aarch64.app.tar.gz"
        }
      ]
    })
  ),
  {
    version: "0.2.0",
    notes: "AI Cove Design 0.2.0",
    pub_date: "2026-06-08T00:00:00.000Z",
    platforms: {
      "windows-x86_64": {
        signature: "windows-signature",
        url: "https://ai-cove.com/downloads/ai-cove-design-desktop-windows.exe?v=0.1.9"
      },
      "darwin-aarch64": {
        signature: "mac-signature",
        url: "https://ai-cove.com/downloads/ai-cove-design-desktop-macos-aarch64.app.tar.gz?v=0.2.0"
      }
    }
  }
);

process.stdout.write("desktop-build.test.mjs passed\n");

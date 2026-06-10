import assert from "node:assert/strict";

const {
  desktopSidecarStartupInitialState,
  isDesktopSidecarOrigin
} = await import("./desktop-sidecar-startup.js");

assert.equal(isDesktopSidecarOrigin(new URL("http://127.0.0.1:8788/")), true, "local sidecar origin should be treated as ready");
assert.equal(isDesktopSidecarOrigin(new URL("http://localhost:8788/")), true, "localhost sidecar origin should be treated as ready");
assert.equal(isDesktopSidecarOrigin(new URL("tauri://localhost/")), false, "packaged desktop origin should wait for the sidecar");

assert.deepEqual(
  desktopSidecarStartupInitialState({
    tauriRuntime: true,
    location: new URL("tauri://localhost/")
  }),
  {
    status: "starting",
    message: "正在启动本地服务..."
  }
);

assert.deepEqual(
  desktopSidecarStartupInitialState({
    tauriRuntime: false,
    location: new URL("https://design.ai-cove.com/")
  }),
  {
    status: "unsupported",
    message: null
  }
);

process.stdout.write("desktop-sidecar-startup.smoke.ts passed\n");

import assert from "node:assert/strict";

const { isTauriRuntime } = await import("./desktop-runtime.js");

const originalWindow = globalThis.window;

try {
  Reflect.deleteProperty(globalThis, "window");
  assert.equal(isTauriRuntime(), false, "server-like runtimes should not be treated as Tauri");

  globalThis.window = {} as Window & typeof globalThis;
  assert.equal(isTauriRuntime(), false, "ordinary browser runtimes should not be treated as Tauri");

  globalThis.window = { __TAURI_INTERNALS__: {} } as unknown as Window & typeof globalThis;
  assert.equal(isTauriRuntime(), true, "Tauri internals should enable desktop-only UI");
} finally {
  if (originalWindow) {
    globalThis.window = originalWindow;
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
}

process.stdout.write("desktop-runtime.smoke.ts passed\n");

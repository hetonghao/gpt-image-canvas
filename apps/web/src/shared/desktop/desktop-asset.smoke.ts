import assert from "node:assert/strict";

const storage = new Map<string, string>();
const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
const revealedPaths: string[] = [];

globalThis.window = {
  __TAURI_INTERNALS__: {},
  location: {
    href: "http://127.0.0.1:8787/",
    origin: "http://127.0.0.1:8787",
    search: ""
  },
  sessionStorage: {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    }
  },
  localStorage: {
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    }
  }
} as unknown as Window & typeof globalThis;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  fetchCalls.push({ input, init });
  return Response.json({ filePath: "/tmp/ai-cove/assets/generated.png" });
}) as typeof fetch;

const { revealDesktopAssetFile } = await import("./desktop-asset.js");

storage.set("ai-cove-design.hostToken", "desktop-token");
storage.set("ai-cove-design.hostUserId", "42");

assert.equal(
  await revealDesktopAssetFile("asset-1", {
    revealItemInDir: async (filePath) => {
      if (Array.isArray(filePath)) {
        throw new Error("revealItemInDir should receive one file path.");
      }
      revealedPaths.push(filePath);
    }
  }),
  true
);
assert.deepEqual(revealedPaths, ["/tmp/ai-cove/assets/generated.png"]);
assert.match(String(fetchCalls[0]?.input), /\/api\/assets\/asset-1\/location/u);

delete (globalThis.window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

assert.equal(
  await revealDesktopAssetFile("asset-2", {
    revealItemInDir: async (filePath) => {
      if (Array.isArray(filePath)) {
        throw new Error("revealItemInDir should receive one file path.");
      }
      revealedPaths.push(filePath);
    }
  }),
  false
);
assert.deepEqual(revealedPaths, ["/tmp/ai-cove/assets/generated.png"]);

process.stdout.write("desktop-asset.smoke.ts passed\n");

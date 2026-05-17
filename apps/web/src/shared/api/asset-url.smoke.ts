import assert from "node:assert/strict";

globalThis.window = {
  location: {
    href: "http://127.0.0.1:8787/?token=query-token",
    origin: "http://127.0.0.1:8787",
    search: "?token=query-token"
  },
  sessionStorage: {
    getItem() {
      return null;
    },
    setItem() {}
  },
  localStorage: {
    getItem() {
      return null;
    },
    setItem() {}
  }
} as unknown as Window & typeof globalThis;

const { normalizeAssetUrl } = await import("./asset-url.js");

assert.equal(normalizeAssetUrl("/api/assets/asset-1"), "/api/assets/asset-1?token=query-token");
assert.equal(normalizeAssetUrl("/api/assets/asset-1/download"), "/api/assets/asset-1/download?token=query-token");
assert.equal(normalizeAssetUrl("https://example.com/image.png"), "https://example.com/image.png");

process.stdout.write("asset-url.smoke.ts passed\n");

import assert from "node:assert/strict";

const capturedFetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
const storage = new Map<string, string>();

globalThis.window = {
  location: {
    href: "http://127.0.0.1:8787/?token=query-token&user_id=42",
    origin: "http://127.0.0.1:8787",
    search: "?token=query-token&user_id=42"
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
  capturedFetchCalls.push({ input, init });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const { apiFetch, appendHostTokenParam, saveHostCredentials, withHostTokenParam } = await import("./host-token.js");

await apiFetch("/api/host/session");

const apiFetchHeaders = new Headers(capturedFetchCalls[0]?.init?.headers);
assert.equal(apiFetchHeaders.get("authorization"), "Bearer query-token");
assert.equal(apiFetchHeaders.get("new-api-user"), "42");

assert.equal(
  withHostTokenParam("/api/assets/asset-1"),
  "/api/assets/asset-1?token=query-token&user_id=42"
);

const socketUrl = new URL("ws://127.0.0.1:8787/api/agent/ws");
appendHostTokenParam(socketUrl);
assert.equal(socketUrl.searchParams.get("token"), "query-token");
assert.equal(socketUrl.searchParams.get("user_id"), "42");

saveHostCredentials("saved-token", "84");
assert.equal(window.sessionStorage.getItem("ai-cove-design.hostToken"), "saved-token");
assert.equal(window.sessionStorage.getItem("ai-cove-design.hostUserId"), "84");

process.stdout.write("host-token.smoke.ts passed\n");

import assert from "node:assert/strict";

const capturedFetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
const storage = new Map<string, string>();
const parentMessages: Array<{ message: unknown; targetOrigin: string }> = [];
const parentWindow = {
  postMessage(message: unknown, targetOrigin: string) {
    parentMessages.push({ message, targetOrigin });
  }
};
let messageListener: ((event: MessageEvent) => void) | undefined;
const dispatchedEvents: string[] = [];
let cookieValue = "";

globalThis.window = {
  location: {
    href: "http://127.0.0.1:8787/?token=query-token&user_id=42",
    origin: "http://127.0.0.1:8787",
    search: "?token=query-token&user_id=42&auth_parent_origin=https%3A%2F%2Fai-cove.com",
    reload() {}
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
  },
  parent: parentWindow,
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    assert.equal(type, "message");
    messageListener = listener;
  },
  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    assert.equal(type, "message");
    assert.equal(listener, messageListener);
  },
  dispatchEvent(event: Event) {
    dispatchedEvents.push(event.type);
    return true;
  }
} as unknown as Window & typeof globalThis;

globalThis.document = {
  get cookie() {
    return cookieValue;
  },
  set cookie(value: string) {
    cookieValue = value;
  }
} as unknown as Document;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  capturedFetchCalls.push({ input, init });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const { apiFetch, appendHostTokenParam, installHostCredentialsMessageBridge, saveHostCredentials, withHostTokenParam } = await import("./host-token.js");

await apiFetch("/api/host/session");

const apiFetchHeaders = new Headers(capturedFetchCalls[0]?.init?.headers);
assert.equal(apiFetchHeaders.get("authorization"), "Bearer query-token");
assert.equal(apiFetchHeaders.get("new-api-user"), "42");

assert.equal(
  withHostTokenParam("/api/assets/asset-1"),
  "/api/assets/asset-1?user_id=42"
);

const socketUrl = new URL("ws://127.0.0.1:8787/api/agent/ws");
appendHostTokenParam(socketUrl);
assert.equal(socketUrl.searchParams.get("token"), null);
assert.equal(socketUrl.searchParams.get("user_id"), "42");
assert.match(cookieValue, /^ai_cove_design_access=query-token; Path=\/api; SameSite=Strict/u);

saveHostCredentials("saved-token", "84");
assert.equal(window.sessionStorage.getItem("ai-cove-design.hostToken"), "saved-token");
assert.equal(window.sessionStorage.getItem("ai-cove-design.hostUserId"), "84");

const disposeBridge = installHostCredentialsMessageBridge();
assert.ok(messageListener);
assert.deepEqual(parentMessages, [{ message: { type: "ai-cove-design.ready" }, targetOrigin: "https://ai-cove.com" }]);
messageListener({
  source: parentWindow,
  origin: "https://ai-cove.com",
  data: {
    type: "ai-cove-design.host-credentials",
    token: "rotated-token",
    userId: "84"
  }
} as unknown as MessageEvent);
assert.equal(window.sessionStorage.getItem("ai-cove-design.hostToken"), "rotated-token");
assert.deepEqual(dispatchedEvents, ["ai-cove-design:host-credentials-updated"]);

messageListener({
  source: parentWindow,
  origin: "https://attacker.example",
  data: {
    type: "ai-cove-design.host-credentials",
    token: "attacker-token",
    userId: "99"
  }
} as unknown as MessageEvent);
assert.equal(window.sessionStorage.getItem("ai-cove-design.hostToken"), "rotated-token");
disposeBridge();

process.stdout.write("host-token.smoke.ts passed\n");

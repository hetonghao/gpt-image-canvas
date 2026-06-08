import assert from "node:assert/strict";

const storage = new Map<string, string>();
const openedUrls: string[] = [];
const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

globalThis.window = {
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

let sessionAuthenticated = false;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  fetchCalls.push({ input, init });
  const url = typeof input === "string" ? input : input.toString();

  if (url === "/api/desktop-auth/start") {
    return Response.json({ loginUrl: "https://ai-cove.com/desktop-auth?nonce=abc" });
  }

  if (url === "/api/desktop-auth/session") {
    return Response.json(
      sessionAuthenticated
        ? {
            authenticated: true,
            token: "desktop-token",
            userId: "42"
          }
        : {
            authenticated: false
          }
    );
  }

  return new Response("not found", { status: 404 });
}) as typeof fetch;

const { restoreDesktopAuthSession, startDesktopAuthLogin, waitForDesktopAuthSession } = await import("./desktop-auth.js");

assert.equal(await restoreDesktopAuthSession(), false, "empty desktop session should not restore credentials");
assert.equal(storage.has("ai-cove-design.hostToken"), false);

await startDesktopAuthLogin({
  openUrl: async (url: string) => {
    openedUrls.push(url);
  }
});
assert.deepEqual(openedUrls, ["https://ai-cove.com/desktop-auth?nonce=abc"]);
assert.equal(fetchCalls.at(-1)?.init?.method, "POST");

sessionAuthenticated = true;
assert.equal(
  await waitForDesktopAuthSession({
    intervalMs: 1,
    timeoutMs: 20,
    sleep: async () => {}
  }),
  true
);
assert.equal(storage.get("ai-cove-design.hostToken"), "desktop-token");
assert.equal(storage.get("ai-cove-design.hostUserId"), "42");

process.stdout.write("desktop-auth.smoke.ts passed\n");

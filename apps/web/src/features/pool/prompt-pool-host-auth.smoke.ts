import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const capturedFetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];

globalThis.window = {
  location: {
    href: "http://127.0.0.1:48787/pool?ui_mode=embedded&user_id=42",
    origin: "http://127.0.0.1:48787",
    search: "?ui_mode=embedded&user_id=42"
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

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  capturedFetchCalls.push({ input, init });
  return new Response(JSON.stringify({ groups: [], favorites: [] }), { status: 200 });
}) as typeof fetch;

const { fetchPromptFavorites } = await import("../prompt-favorites/promptFavoritesApi.js");

await fetchPromptFavorites();

const favoritesHeaders = new Headers(capturedFetchCalls[0]?.init?.headers);
assert.equal(favoritesHeaders.get("new-api-user"), "42", "prompt favorites requests should forward the AI Cove user id");

const promptPoolPageSource = await readFile(join(currentDir, "PromptPoolPage.tsx"), "utf8");
assert.match(promptPoolPageSource, /apiFetch\(["']\/api\/pool["']/u, "Prompt Pool data requests should use apiFetch");
assert.doesNotMatch(promptPoolPageSource, /fetch\(["']\/api\/pool["']/u, "Prompt Pool data requests should not use bare fetch");

process.stdout.write("prompt-pool-host-auth.smoke.ts passed\n");

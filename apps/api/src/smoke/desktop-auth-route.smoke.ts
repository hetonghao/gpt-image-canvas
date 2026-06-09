import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "ai-cove-design-desktop-auth-"));
process.env.DESKTOP_AUTH_ENABLED = "1";
process.env.HOST_ADAPTER = "ai-cove-new-api";
process.env.AI_COVE_PUBLIC_BASE_URL = "https://ai-cove.com";
process.env.AI_COVE_API_BASE_URL = "https://ai-cove.com";

try {
  const { createApp } = await import("../server/app.js");
  const app = createApp();

  const emptySessionResponse = await app.request("http://127.0.0.1:8787/api/desktop-auth/session");
  assert.equal(emptySessionResponse.status, 200);
  assert.deepEqual(await emptySessionResponse.json(), { authenticated: false });

  const startResponse = await app.request("http://127.0.0.1:8787/api/desktop-auth/start", {
    method: "POST"
  });
  assert.equal(startResponse.status, 200);
  const startBody = (await startResponse.json()) as { loginUrl: string; nonce: string };
  assert.match(startBody.nonce, /^[a-f0-9]{32}$/u);

  const loginUrl = new URL(startBody.loginUrl);
  assert.equal(loginUrl.origin, "https://ai-cove.com");
  assert.equal(loginUrl.pathname, "/desktop-auth");
  assert.equal(loginUrl.searchParams.get("nonce"), startBody.nonce);
  assert.equal(loginUrl.searchParams.get("redirect_uri"), "http://127.0.0.1:8787/api/desktop-auth/callback");

  const mismatchResponse = await app.request(
    `http://127.0.0.1:8787/api/desktop-auth/callback?nonce=wrong&token=desktop-token&user_id=42`
  );
  assert.equal(mismatchResponse.status, 400);

  const callbackResponse = await app.request(
    `http://127.0.0.1:8787/api/desktop-auth/callback?nonce=${startBody.nonce}&token=desktop-token&user_id=42`
  );
  assert.equal(callbackResponse.status, 200);
  const callbackHtml = await callbackResponse.text();
  assert.match(callbackHtml, /AI Cove Design/u);
  assert.match(callbackHtml, /brand-logo\.png/u);
  assert.match(callbackHtml, /desktop-auth-complete/u);

  const savedSessionResponse = await app.request("http://127.0.0.1:8787/api/desktop-auth/session");
  assert.equal(savedSessionResponse.status, 200);
  assert.deepEqual(await savedSessionResponse.json(), {
    authenticated: true,
    token: "desktop-token",
    userId: "42"
  });
} finally {
  await rm(process.env.DATA_DIR, { force: true, recursive: true });
}

process.stdout.write("desktop-auth-route.smoke.ts passed\n");

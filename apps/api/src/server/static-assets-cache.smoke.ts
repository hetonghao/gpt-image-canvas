import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

const LONG_CACHE = "public, max-age=31536000, immutable";
const ROOT_STATIC_IMAGES = ["/brand-logo.png", "/favicon.png", "/favicon-32.png", "/apple-touch-icon.png"];
const dataDir = join(tmpdir(), `gpt-image-canvas-static-assets-cache-${process.pid}-${Date.now()}`);

process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

mkdirSync(dataDir, { recursive: true });

async function main(): Promise<void> {
  try {
    const [{ runtimePaths }, { createApp }, { closeDatabase }] = await Promise.all([
      import("../infrastructure/runtime.js"),
      import("./app.js"),
      import("../infrastructure/database.js")
    ]);

    try {
      assert.equal(existsSync(runtimePaths.webDistDir), true, `web dist not found: ${runtimePaths.webDistDir}`);

      const app = createApp();
      const assetPath = pickNonHtmlAssetPath(runtimePaths.webDistDir);

      await assertHasLongCache(app, assetPath, "/assets non-html keeps long cache");

      for (const path of ROOT_STATIC_IMAGES) {
        await assertHasLongCache(app, path, `${path} gets long cache`);
      }

      await assertNoImmutableCache(app, "/", "root HTML fallback is not immutable");
      await assertNoImmutableCache(app, "/route-that-falls-back-to-index", "unknown route HTML fallback is not immutable");
      await assertApiNotCached(app, "/api/not-found");
    } finally {
      closeDatabase();
    }

    process.stdout.write("static-assets-cache.smoke.ts passed\n");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function pickNonHtmlAssetPath(webDistDir: string): string {
  const assetsDir = join(webDistDir, "assets");
  const assetFile = readdirSync(assetsDir).find((file) => extname(file) !== ".html");
  assert.ok(assetFile, `no non-html asset found in ${assetsDir}`);
  return `/assets/${assetFile}`;
}

async function assertHasLongCache(app: RequestApp, path: string, message: string): Promise<void> {
  const response = await request(app, path);
  assert.equal(response.status, 200, `${message}: response status`);
  assert.equal(response.headers.get("Cache-Control"), LONG_CACHE, `${message}: Cache-Control`);
}

async function assertNoImmutableCache(app: RequestApp, path: string, message: string): Promise<void> {
  const response = await request(app, path);
  assert.equal(response.ok, true, `${message}: response status`);
  assert.notEqual(response.headers.get("Cache-Control"), LONG_CACHE, `${message}: Cache-Control should not be immutable`);
}

async function assertApiNotCached(app: RequestApp, path: string): Promise<void> {
  const response = await request(app, path);
  assert.equal(response.status, 404, "/api/* keeps API not-found response");
  assert.notEqual(response.headers.get("Cache-Control"), LONG_CACHE, "/api/* does not get immutable static cache");
}

interface RequestApp {
  fetch(request: Request): Response | Promise<Response>;
}

function request(app: RequestApp, path: string): Promise<Response> {
  return Promise.resolve(app.fetch(new Request(`http://127.0.0.1:8787${path}`)));
}

void main();

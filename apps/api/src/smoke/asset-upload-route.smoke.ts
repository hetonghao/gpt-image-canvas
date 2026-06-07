import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-asset-upload-"));

process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.HOST_ADAPTER = "standalone";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

try {
  const [{ createApp }, { closeDatabase }] = await Promise.all([
    import("../server/app.js"),
    import("../infrastructure/database.js")
  ]);
  const app = createApp();

  const response = await app.fetch(
    new Request("http://127.0.0.1:8787/api/assets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dataUrl: `data:image/png;base64,${tinyPngBase64}`,
        fileName: "canvas.png"
      })
    })
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    id?: string;
    url?: string;
    fileName?: string;
    mimeType?: string;
    width?: number;
    height?: number;
  };
  assert.equal(typeof body.id, "string");
  assert.equal(body.url, `/api/assets/${body.id}`);
  assert.equal(body.fileName, "canvas.png");
  assert.equal(body.mimeType, "image/png");
  assert.equal(body.width, 1);
  assert.equal(body.height, 1);

  const assetResponse = await app.fetch(new Request(`http://127.0.0.1:8787/api/assets/${body.id}`));
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers.get("content-type"), "image/png");

  console.log("asset-upload-route.smoke.ts passed");
  closeDatabase();
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

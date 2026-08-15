import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const tinyPngBytes = Buffer.from(tinyPngBase64, "base64");
const expectedContentSha256 = createHash("sha256").update(tinyPngBytes).digest("hex");

try {
  const [{ createApp }, { closeDatabase }, imageGeneration] = await Promise.all([
    import("../server/app.js"),
    import("../infrastructure/database.js"),
    import("../domain/generation/image-generation.js")
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
    byteSize?: number;
    contentSha256?: string;
  };
  assert.equal(typeof body.id, "string");
  assert.equal(body.url, `/api/assets/${body.id}`);
  assert.equal(body.fileName, "canvas.png");
  assert.equal(body.mimeType, "image/png");
  assert.equal(body.width, 1);
  assert.equal(body.height, 1);
  assert.equal(body.byteSize, tinyPngBytes.byteLength);
  assert.equal(body.contentSha256, expectedContentSha256);

  const duplicateResponse = await app.fetch(
    new Request("http://127.0.0.1:8787/api/assets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        dataUrl: `data:image/jpeg;base64,${tinyPngBase64}`,
        fileName: "same-bytes-different-name.jpg"
      })
    })
  );
  assert.equal(duplicateResponse.status, 200);
  const duplicateBody = (await duplicateResponse.json()) as typeof body;
  assert.equal(duplicateBody.id, body.id);
  assert.equal(duplicateBody.mimeType, "image/png");
  assert.equal(duplicateBody.contentSha256, body.contentSha256);

  const metadataResponse = await app.fetch(new Request(`http://127.0.0.1:8787/api/assets/${body.id}/metadata`));
  assert.equal(metadataResponse.status, 200);
  assert.deepEqual(await metadataResponse.json(), {
    id: body.id,
    fileName: "canvas.png",
    mimeType: "image/png",
    width: 1,
    height: 1,
    byteSize: tinyPngBytes.byteLength,
    contentSha256: expectedContentSha256
  });

  const userA = hostContext("asset-user-a", "Ada");
  const userB = hostContext("asset-user-b", "Grace");
  const userAAsset = await imageGeneration.saveUploadedImageAsset(
    { dataUrl: `data:image/png;base64,${tinyPngBase64}`, fileName: "user-a.png" },
    userA
  );
  const sameUserAsset = await imageGeneration.saveUploadedImageAsset(
    { dataUrl: `data:image/png;base64,${tinyPngBase64}`, fileName: "renamed.png" },
    userA
  );
  const userBAsset = await imageGeneration.saveUploadedImageAsset(
    { dataUrl: `data:image/png;base64,${tinyPngBase64}`, fileName: "user-b.png" },
    userB
  );
  assert.equal(sameUserAsset.id, userAAsset.id);
  assert.equal(sameUserAsset.fileName, userAAsset.fileName);
  assert.notEqual(userBAsset.id, userAAsset.id);
  assert.equal(imageGeneration.getStoredAssetFile(userAAsset.id, userB), undefined);
  assert.equal(imageGeneration.getStoredAssetFile(userBAsset.id, userA), undefined);
  assert.equal(imageGeneration.getStoredAssetFile(userBAsset.id, userB)?.contentSha256, expectedContentSha256);

  const assetResponse = await app.fetch(new Request(`http://127.0.0.1:8787/api/assets/${body.id}`));
  assert.equal(assetResponse.status, 200);
  assert.equal(assetResponse.headers.get("content-type"), "image/png");

  console.log("asset-upload-route.smoke.ts passed");
  closeDatabase();
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

function hostContext(id: string, displayName: string): {
  user: { id: string; displayName: string };
} {
  return { user: { id, displayName } };
}

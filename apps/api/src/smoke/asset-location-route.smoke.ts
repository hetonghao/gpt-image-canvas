import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-asset-location-"));

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

  const uploadResponse = await app.fetch(
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

  assert.equal(uploadResponse.status, 200);
  const uploaded = (await uploadResponse.json()) as { id?: string };
  assert.equal(typeof uploaded.id, "string");

  const disabledResponse = await app.fetch(new Request(`http://127.0.0.1:8787/api/assets/${uploaded.id}/location`));
  assert.equal(disabledResponse.status, 404);

  process.env.DESKTOP_AUTH_ENABLED = "1";

  const enabledResponse = await app.fetch(new Request(`http://127.0.0.1:8787/api/assets/${uploaded.id}/location`));
  assert.equal(enabledResponse.status, 200);
  const location = (await enabledResponse.json()) as { filePath?: string };
  assert.equal(typeof location.filePath, "string");
  assert.equal(location.filePath?.startsWith(dataDir), true);

  rmSync(location.filePath ?? "", { force: true });

  const missingLocalFileResponse = await app.fetch(new Request(`http://127.0.0.1:8787/api/assets/${uploaded.id}/location`));
  assert.equal(missingLocalFileResponse.status, 404);

  console.log("asset-location-route.smoke.ts passed");
  closeDatabase();
} finally {
  delete process.env.DESKTOP_AUTH_ENABLED;
  rmSync(dataDir, { recursive: true, force: true });
}

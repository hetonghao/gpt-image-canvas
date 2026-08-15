import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-project-compression-"));
const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
after(() => rmSync(dataDir, { recursive: true, force: true }));

process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.HOST_ADAPTER = "standalone";

{
  seedProjectDatabase(join(dataDir, "gpt-image-canvas.sqlite"));

  const { createApp } = await import("../server/app.js");
  const { parseProjectPayload } = await import("../server/http/validation.js");
  const app = createApp();

  test("GET /api/project returns gzip when the client accepts compressed JSON", async () => {
    const response = await app.fetch(
      new Request("http://127.0.0.1:8787/api/project", {
        headers: {
          "Accept-Encoding": "gzip"
        }
      })
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-encoding"), "gzip");
  });

  test("PUT /api/project saves only complete Excalidraw asset references", async () => {
    const uploadResponse = await app.fetch(
      new Request("http://127.0.0.1:8787/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl: `data:image/png;base64,${tinyPngBase64}`, fileName: "scene.png" })
      })
    );
    assert.equal(uploadResponse.status, 200);
    const asset = (await uploadResponse.json()) as {
      id: string;
      fileName: string;
      mimeType: string;
      width: number;
      height: number;
      byteSize: number;
      contentSha256: string;
    };
    const snapshot = excalidrawSnapshot(asset);

    const saveResponse = await putProject(app, snapshot);
    assert.equal(saveResponse.status, 200);

    const projectResponse = await app.fetch(new Request("http://127.0.0.1:8787/api/project"));
    assert.equal(projectResponse.status, 200);
    const project = (await projectResponse.json()) as { snapshot?: unknown };
    assert.deepEqual(project.snapshot, snapshot);

    const mismatchResponse = await putProject(app, excalidrawSnapshot({ ...asset, byteSize: asset.byteSize + 1 }));
    assert.equal(mismatchResponse.status, 409);
    assert.equal(((await mismatchResponse.json()) as { error?: { code?: string } }).error?.code, "project_asset_mismatch");
  });

  test("PUT /api/project rejects missing assets and embedded image bytes", async () => {
    const missingAsset = {
      id: "missing",
      fileName: "missing.png",
      mimeType: "image/png",
      width: 1,
      height: 1,
      byteSize: 68,
      contentSha256: "0".repeat(64)
    };
    const missingResponse = await putProject(app, excalidrawSnapshot(missingAsset));
    assert.equal(missingResponse.status, 409);
    assert.equal(((await missingResponse.json()) as { error?: { code?: string } }).error?.code, "project_asset_missing");

    const embeddedResponse = await putProject(app, {
      ...excalidrawSnapshot(missingAsset),
      files: { file: { dataURL: `data:image/png;base64,${tinyPngBase64}` } }
    });
    assert.equal(embeddedResponse.status, 400);
    assert.equal(((await embeddedResponse.json()) as { error?: { code?: string } }).error?.code, "invalid_snapshot");
  });

  test("PUT /api/project rejects embedded asset locations nested in element arrays", async () => {
    const response = await putProject(app, {
      ...emptyExcalidrawSnapshot(),
      scene: {
        elements: [
          {
            id: "rectangle-1",
            type: "rectangle",
            customData: {
              previews: [{ src: `data:image/png;base64,${tinyPngBase64}` }]
            }
          }
        ],
        appState: {}
      }
    });

    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { error?: { code?: string } }).error?.code, "invalid_snapshot");
  });

  test("PUT /api/project rejects embedded asset locations in appState", async () => {
    const response = await putProject(app, {
      ...emptyExcalidrawSnapshot(),
      scene: {
        elements: [{ id: "rectangle-1", type: "rectangle" }],
        appState: {
          preview: {
            url: "/api/assets/private"
          }
        }
      }
    });

    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { error?: { code?: string } }).error?.code, "invalid_snapshot");
  });

  test("project snapshot limit accepts exactly 104857600 bytes and rejects 104857601", () => {
    const accepted = parseProjectPayload({ snapshot: snapshotWithTextBytes(104_857_600) });
    assert.equal(accepted.ok, true);

    const rejected = parseProjectPayload({ snapshot: snapshotWithTextBytes(104_857_601) });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) {
      assert.equal(rejected.error.error.code, "invalid_snapshot");
    }
  });

  console.log("project-route-compression.smoke.ts passed");
}

function seedProjectDatabase(filePath: string): void {
  const sqlite = new Database(filePath);
  try {
    sqlite.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'standalone',
        name TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const largeSnapshot = JSON.stringify({
      format: "ai-cove-excalidraw",
      version: 1,
      scene: {
        elements: [
          {
            id: "text-1",
            type: "text",
            text: "x".repeat(32_768)
          }
        ],
        appState: {}
      },
      assets: {}
    });

    sqlite
      .prepare(
        `insert into projects (id, user_id, name, snapshot_json, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?)`
      )
      .run("default", "standalone", "Default Project", largeSnapshot, "2026-06-07T00:00:00.000Z", "2026-06-07T00:00:00.000Z");
  } finally {
    sqlite.close();
  }
}

function excalidrawSnapshot(asset: {
  id: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  contentSha256: string;
}): Record<string, unknown> {
  return {
    format: "ai-cove-excalidraw",
    version: 1,
    scene: {
      elements: [
        {
          id: "image-1",
          type: "image",
          fileId: "file-1",
          x: 0,
          y: 0,
          width: 100,
          height: 100
        }
      ],
      appState: {}
    },
    assets: {
      "file-1": {
        assetId: asset.id,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        byteSize: asset.byteSize,
        contentSha256: asset.contentSha256
      }
    }
  };
}

function emptyExcalidrawSnapshot(): Record<string, unknown> {
  return {
    format: "ai-cove-excalidraw",
    version: 1,
    scene: {
      elements: [],
      appState: {}
    },
    assets: {}
  };
}

function snapshotWithTextBytes(targetBytes: number): Record<string, unknown> {
  const scene = {
    elements: [{ id: "text-1", type: "text", text: "" }],
    appState: {}
  };
  const snapshot = {
    format: "ai-cove-excalidraw",
    version: 1,
    scene,
    assets: {}
  };
  const textBytes = targetBytes - Buffer.byteLength(JSON.stringify(snapshot), "utf8");
  assert.ok(textBytes >= 0, "snapshot target must include its fixed JSON overhead");
  scene.elements[0].text = "x".repeat(textBytes);
  assert.equal(Buffer.byteLength(JSON.stringify(snapshot), "utf8"), targetBytes);
  return snapshot;
}

async function putProject(app: { fetch(request: Request): Response | Promise<Response> }, snapshot: unknown): Promise<Response> {
  return Promise.resolve(app.fetch(
    new Request("http://127.0.0.1:8787/api/project", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot })
    })
  ));
}

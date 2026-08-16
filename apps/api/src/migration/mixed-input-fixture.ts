import { createHash } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { isRecord, numberValue, stringValue } from "./json.js";
import { seedMigrationFixture, tinyPngBytes } from "./fixtures.js";

export const embeddedPngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

export type MixedInputFixture = {
  readonly inputDir: string;
  readonly targetProjectId: string;
  readonly targetSnapshotJson: string;
  readonly embeddedProjectId: string;
  readonly embeddedAssetId: string;
};

export function seedMixedInputFixture(rootDir: string): MixedInputFixture {
  const fixture = seedMigrationFixture(rootDir, "success");
  const database = new Database(join(fixture.inputDir, "gpt-image-canvas.sqlite"));
  try {
    const row = database.prepare("SELECT id, file_name, mime_type, width, height FROM assets LIMIT 1").get();
    if (!isRecord(row)) throw new Error("expected fixture asset");
    const assetId = stringValue(row.id);
    const fileName = stringValue(row.file_name);
    const mimeType = stringValue(row.mime_type);
    const width = numberValue(row.width);
    const height = numberValue(row.height);
    if (!assetId || !fileName || !mimeType || width === undefined || height === undefined) throw new Error("fixture asset is invalid");

    const contentSha256 = createHash("sha256").update(tinyPngBytes).digest("hex");
    const targetSnapshotJson = JSON.stringify({
      format: "ai-cove-excalidraw",
      version: 1,
      scene: {
        elements: [{ id: "target-image", type: "image", fileId: "target-file", x: 0, y: 0, width: 100, height: 100 }],
        appState: { theme: "light" }
      },
      assets: {
        "target-file": { assetId, fileName, mimeType, width, height, byteSize: tinyPngBytes.byteLength, contentSha256 }
      }
    });
    database.prepare("UPDATE projects SET snapshot_json = ? WHERE id = ?").run(targetSnapshotJson, fixture.projectId);

    const embeddedProjectId = "fixture-embedded-asset";
    const embeddedAssetId = "embedded-recovered";
    const embeddedSnapshotJson = JSON.stringify({
      document: {
        store: {
          "document:document": { id: "document:document", typeName: "document", name: "" },
          "page:page-1": { id: "page:page-1", typeName: "page", name: "Page 1", index: "a1" },
          [`asset:${embeddedAssetId}`]: {
            id: `asset:${embeddedAssetId}`,
            typeName: "asset",
            props: {
              name: "embedded.png",
              src: `data:image/png;base64,${embeddedPngBytes.toString("base64")}`,
              w: 1,
              h: 1,
              fileSize: embeddedPngBytes.byteLength,
              mimeType: "image/png",
              isAnimated: false
            },
            meta: {}
          },
          "shape:image-embedded": {
            id: "shape:image-embedded",
            typeName: "shape",
            type: "image",
            x: 20,
            y: 30,
            rotation: 0,
            index: "a1",
            parentId: "page:page-1",
            props: { assetId: `asset:${embeddedAssetId}`, w: 120, h: 120, crop: null, flipX: false, flipY: false, altText: "" }
          }
        }
      },
      session: {}
    });
    database.prepare(
      `INSERT INTO projects (id, user_id, name, snapshot_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(embeddedProjectId, "user-1", "Embedded asset", embeddedSnapshotJson, "2026-08-15T00:00:00.000Z", "2026-08-15T00:00:00.000Z");

    return {
      inputDir: fixture.inputDir,
      targetProjectId: fixture.projectId,
      targetSnapshotJson,
      embeddedProjectId,
      embeddedAssetId
    };
  } finally {
    database.close();
  }
}

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { isRecord, stringValue } from "./json.js";
import { seedMigrationFixture, tinyPngBytes } from "./fixtures.js";
import type { MigrationFixture } from "./fixtures.js";

export function seedDuplicateAssetFixture(rootDir: string): MigrationFixture {
  const fixture = seedMigrationFixture(rootDir, "success");
  const duplicateId = "asset-success-duplicate";
  writeFileSync(join(fixture.inputDir, "assets", `${duplicateId}.png`), tinyPngBytes);
  const database = new Database(join(fixture.inputDir, "gpt-image-canvas.sqlite"));
  try {
    database.prepare(
      `INSERT INTO assets (
        id, user_id, file_name, relative_path, mime_type, width, height, byte_size, content_sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(duplicateId, "user-1", `${duplicateId}.png`, `assets/${duplicateId}.png`, "image/png", 1, 1, null, null, "2026-08-15T00:00:00.000Z");
    const sourceSnapshotJson = addDuplicateImage(fixture.sourceSnapshotJson, duplicateId);
    database.prepare("UPDATE projects SET snapshot_json = ? WHERE id = ?").run(sourceSnapshotJson, fixture.projectId);
    database.prepare("UPDATE generation_records SET reference_asset_id = ? WHERE id = ?").run(duplicateId, "generation-1");
    database.prepare("UPDATE generation_outputs SET asset_id = ? WHERE id = ?").run(duplicateId, "output-1");
    database.prepare("UPDATE generation_reference_assets SET asset_id = ? WHERE generation_id = ?").run(duplicateId, "generation-1");
    database.prepare(
      "UPDATE agent_conversations SET messages_json = replace(messages_json, ?, ?), context_json = replace(context_json, ?, ?) WHERE id = ?"
    ).run("asset-success", duplicateId, "asset-success", duplicateId, "conversation-1");
    database.prepare("UPDATE agent_conversations SET messages_json = replace(messages_json, ?, ?) WHERE id = ?").run("/api/assets/preview", `/api/assets/${duplicateId}`, "conversation-1");
    database.exec("CREATE TABLE asset_links (id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, asset_id TEXT, asset_url TEXT, asset_ids_json TEXT NOT NULL)");
    database.prepare("INSERT INTO asset_links (id, user_id, asset_id, asset_url, asset_ids_json) VALUES (?, ?, ?, ?, ?)").run("link-1", "user-1", duplicateId, `/api/assets/${duplicateId}`, JSON.stringify([duplicateId]));
    return { ...fixture, sourceSnapshotJson };
  } finally {
    database.close();
  }
}

function addDuplicateImage(snapshotJson: string, duplicateId: string): string {
  const parsed: unknown = JSON.parse(snapshotJson);
  if (!isRecord(parsed)) throw new Error("expected source snapshot");
  const document = isRecord(parsed.document) ? parsed.document : undefined;
  const store = document && isRecord(document.store) ? document.store : undefined;
  if (!store) throw new Error("expected source store");
  store[`asset:${duplicateId}`] = {
    id: `asset:${duplicateId}`,
    typeName: "asset",
    props: { w: 1, h: 1, mimeType: "image/png", src: `/api/assets/${duplicateId}` },
    meta: { localAssetId: duplicateId }
  };
  store["shape:image-duplicate-content"] = {
    id: "shape:image-duplicate-content",
    typeName: "shape",
    type: "image",
    x: 270,
    y: 20,
    rotation: 0,
    index: "a4",
    parentId: "page:page-1",
    props: { assetId: `asset:${duplicateId}`, w: 100, h: 100, crop: null, flipX: false, flipY: false, altText: "" }
  };
  return JSON.stringify(parsed);
}

export function assetIdFromRow(value: unknown): string {
  if (!isRecord(value)) throw new Error("expected asset row");
  const id = stringValue(value.id);
  if (!id) throw new Error("expected asset id");
  return id;
}

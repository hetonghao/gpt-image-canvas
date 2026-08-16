import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { addDrawSegmentsShape } from "./fixture-shapes.js";

export const tinyPngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

export const PRIVATE_PROMPT = "PRIVATE_USER_PROMPT_SHOULD_NOT_LEAK";
export const PRIVATE_TOKEN = "TOKEN_SHOULD_NOT_LEAK";

export type MigrationFixtureKind = "success" | "unknown-shape" | "missing-asset" | "corrupt-asset" | "multi-page" | "draw-segments" | "degraded-shape" | "legacy-schema" | "dangling-reference";

export type MigrationFixture = {
  readonly inputDir: string;
  readonly projectId: string;
  readonly sourceSnapshotJson: string;
};

export function seedMigrationFixture(rootDir: string, kind: MigrationFixtureKind): MigrationFixture {
  const inputDir = join(rootDir, "input");
  const assetsDir = join(inputDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const databasePath = join(inputDir, "gpt-image-canvas.sqlite");
  const sqlite = new Database(databasePath);
  try {
    sqlite.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE generation_records (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        reference_asset_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE generation_outputs (
        id TEXT PRIMARY KEY NOT NULL,
        generation_id TEXT NOT NULL,
        asset_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE generation_reference_assets (
        generation_id TEXT NOT NULL,
        asset_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE agent_conversations (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        context_json TEXT NOT NULL
      );
      CREATE TABLE private_notes (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL);
    `);
    if (kind !== "legacy-schema") {
      sqlite.exec("ALTER TABLE assets ADD COLUMN byte_size INTEGER; ALTER TABLE assets ADD COLUMN content_sha256 TEXT;");
    }

    const projectId = `fixture-${kind}`;
    const assetId = `asset-${kind}`;
    const assetPath = join(assetsDir, `${assetId}.png`);
    if (kind === "success" || kind === "unknown-shape" || kind === "multi-page" || kind === "draw-segments" || kind === "degraded-shape" || kind === "legacy-schema" || kind === "dangling-reference") {
      writeFileSync(assetPath, tinyPngBytes);
    } else if (kind === "corrupt-asset") {
      writeFileSync(assetPath, Buffer.from("not-an-image"));
    }

    if (kind === "legacy-schema") {
      sqlite
        .prepare(
          `INSERT INTO assets (
            id, user_id, file_name, relative_path, mime_type, width, height, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(assetId, "user-1", `${assetId}.png`, `assets/${assetId}.png`, "image/png", 1, 1, "2026-08-15T00:00:00.000Z");
    } else {
      sqlite
        .prepare(
          `INSERT INTO assets (
            id, user_id, file_name, relative_path, mime_type, width, height, byte_size, content_sha256, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(assetId, "user-1", `${assetId}.png`, `assets/${assetId}.png`, "image/png", 1, 1, null, null, "2026-08-15T00:00:00.000Z");
    }

    const sourceSnapshot = JSON.stringify(makeTldrawSnapshot(kind, assetId));
    sqlite
      .prepare(
        `INSERT INTO projects (id, user_id, name, snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(projectId, "user-1", "Fixture project", sourceSnapshot, "2026-08-15T00:00:00.000Z", "2026-08-15T00:00:00.000Z");
    const referencedAssetId = kind === "dangling-reference" ? "missing-business-asset" : assetId;
    sqlite
      .prepare(
        `INSERT INTO generation_records (id, user_id, reference_asset_id, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run("generation-1", "user-1", referencedAssetId, "2026-08-15T00:00:00.000Z");
    sqlite
      .prepare(
        `INSERT INTO generation_outputs (id, generation_id, asset_id, status, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run("output-1", "generation-1", referencedAssetId, "succeeded", "2026-08-15T00:00:00.000Z");
    sqlite
      .prepare(
        `INSERT INTO generation_reference_assets (generation_id, asset_id, position, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run("generation-1", referencedAssetId, 0, "2026-08-15T00:00:00.000Z");
    const conversationAssetId = kind === "dangling-reference" ? "missing-agent-asset" : assetId;
    const referencedOutputId = kind === "dangling-reference" ? "missing-output" : "output-1";
    const messages = JSON.stringify([
      {
        id: "message-1",
        role: "plan",
        content: PRIVATE_PROMPT,
        previews: [{ id: "preview-1", assetId: conversationAssetId, jobId: "job-1", outputId: referencedOutputId, planId: "plan-1", url: "/api/assets/preview" }],
        plan: { id: "plan-1", jobs: [{ id: "job-1", references: [{ assetId: conversationAssetId }], outputs: [{ id: referencedOutputId, asset: { id: conversationAssetId } }] }] }
      }
    ]);
    const context = JSON.stringify({ previousOutputs: [{ index: 1, assetId: conversationAssetId, outputId: referencedOutputId }] });
    sqlite
      .prepare(
        `INSERT INTO agent_conversations (id, user_id, messages_json, context_json)
         VALUES (?, ?, ?, ?)`
      )
      .run("conversation-1", "user-1", messages, context);
    sqlite.prepare("INSERT INTO private_notes (id, body) VALUES (?, ?)").run("note-1", `${PRIVATE_PROMPT}:${PRIVATE_TOKEN}`);

    return { inputDir, projectId, sourceSnapshotJson: sourceSnapshot };
  } finally {
    sqlite.close();
  }
}

function makeTldrawSnapshot(kind: MigrationFixtureKind, assetId: string): Record<string, unknown> {
  const store: Record<string, unknown> = {
    "document:document": { id: "document:document", typeName: "document", name: "" },
    "page:page-1": { id: "page:page-1", typeName: "page", name: "Page 1", index: "a1" },
    [`asset:${assetId}`]: {
      id: `asset:${assetId}`,
      typeName: "asset",
      props: { w: 1, h: 1, mimeType: "image/png", src: `/api/assets/${assetId}` },
      meta: { localAssetId: assetId }
    },
    "shape:image-1": {
      id: "shape:image-1",
      typeName: "shape",
      type: "image",
      x: 10,
      y: 20,
      rotation: 0,
      index: "a1",
      parentId: "page:page-1",
      props: { assetId: `asset:${assetId}`, w: 100, h: 100, crop: null, flipX: false, flipY: false, altText: "" }
    },
    "shape:image-duplicate": {
      id: "shape:image-duplicate",
      typeName: "shape",
      type: "image",
      x: 140,
      y: 20,
      rotation: 0,
      index: "a2",
      parentId: "page:page-1",
      props: { assetId: `asset:${assetId}`, w: 100, h: 100, crop: null, flipX: false, flipY: false, altText: "" }
    },
    "shape:text-1": {
      id: "shape:text-1",
      typeName: "shape",
      type: "text",
      x: 10,
      y: 150,
      rotation: 0,
      index: "a3",
      parentId: "page:page-1",
      props: { text: PRIVATE_PROMPT, w: 240, h: 40, autoSize: false }
    }
  };

  if (kind === "unknown-shape") {
    store["shape:unknown"] = {
      id: "shape:unknown",
      typeName: "shape",
      type: "mystery-shape",
      x: 0,
      y: 0,
      index: "a4",
      parentId: "page:page-1",
      props: { w: 80, h: 80 }
    };
  }
  if (kind === "multi-page") {
    store["page:page-2"] = { id: "page:page-2", typeName: "page", name: "Page 2", index: "a2" };
    store["shape:text-page-2"] = {
      id: "shape:text-page-2",
      typeName: "shape",
      type: "text",
      x: 20,
      y: 40,
      rotation: 0,
      index: "a1",
      parentId: "page:page-2",
      props: { text: "Page 2", w: 120, h: 40, autoSize: false }
    };
  }
  if (kind === "draw-segments") {
    addDrawSegmentsShape(store);
  }
  if (kind === "degraded-shape") {
    store["shape:degraded"] = {
      id: "shape:degraded",
      typeName: "shape",
      type: "geo",
      x: 0,
      y: 0,
      index: "a4",
      parentId: "page:page-1",
      props: { geo: "star", w: 80, h: 80 }
    };
  }

  return { document: { store }, session: {} };
}

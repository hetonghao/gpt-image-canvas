import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-project-compression-"));

process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.HOST_ADAPTER = "standalone";

try {
  seedProjectDatabase(join(dataDir, "gpt-image-canvas.sqlite"));

  const { createApp } = await import("../server/app.js");
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

  console.log("project-route-compression.smoke.ts passed");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
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
      document: {
        store: {
          "page:1": {
            id: "page:1",
            typeName: "page"
          },
          "shape:1": {
            id: "shape:1",
            typeName: "shape",
            props: {
              text: "x".repeat(32_768)
            }
          }
        }
      }
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

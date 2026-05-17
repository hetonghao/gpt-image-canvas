import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-db-migration-"));

try {
  seedLegacyDatabase(join(dataDir, "gpt-image-canvas.sqlite"));
  process.env.DATA_DIR = dataDir;
  process.env.SQLITE_JOURNAL_MODE = "DELETE";
  process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

  const database = await import("../infrastructure/database.js");
  database.closeDatabase();
  console.log("database migration smoke checks passed");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

function seedLegacyDatabase(filePath: string): void {
  const sqlite = new Database(filePath);
  try {
    sqlite.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO projects (id, name, snapshot_json, created_at, updated_at)
      VALUES ('legacy-project', 'Legacy project', '{}', '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z');
    `);
  } finally {
    sqlite.close();
  }
}

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
  const { listAgentSkills } = await import("../domain/agent/skill-store.js");
  const skills = listAgentSkills({ user: { id: "ai-cove-user", displayName: "AI Cove User" } }).skills;
  if (!skills.some((skill) => skill.slug === "canvas-image-planning")) {
    throw new Error("expected built-in Agent skills to initialize for host users");
  }
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

      CREATE TABLE agent_skills (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        version TEXT,
        source TEXT,
        enabled INTEGER NOT NULL,
        built_in INTEGER NOT NULL,
        is_required INTEGER NOT NULL,
        trigger_mode TEXT NOT NULL,
        trigger_keywords_json TEXT NOT NULL,
        files_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX agent_skills_slug_idx ON agent_skills(slug);

      INSERT INTO agent_skills (
        id,
        slug,
        name,
        description,
        enabled,
        built_in,
        is_required,
        trigger_mode,
        trigger_keywords_json,
        files_json,
        created_at,
        updated_at
      )
      VALUES (
        'agent-skill-canvas-image-planning',
        'canvas-image-planning',
        'canvas-image-planning',
        'legacy built-in skill',
        1,
        1,
        1,
        'always',
        '[]',
        '{"SKILL.md":"legacy"}',
        '2026-05-16T00:00:00.000Z',
        '2026-05-16T00:00:00.000Z'
      );
    `);
  } finally {
    sqlite.close();
  }
}

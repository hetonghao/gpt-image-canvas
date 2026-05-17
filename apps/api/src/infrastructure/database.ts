import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { ensureRuntimeStorage, runtimePaths, sqliteConfig } from "./runtime.js";
import * as schema from "./schema.js";

ensureRuntimeStorage();

const sqlite = new Database(runtimePaths.databaseFile);
configureSqlite(sqlite);

function configureSqlite(database: Database.Database): void {
  database.pragma(`locking_mode = ${sqliteConfig.lockingMode}`);
  database.pragma("foreign_keys = ON");
  applyJournalMode(database);
}

function applyJournalMode(database: Database.Database): void {
  try {
    database.pragma(`journal_mode = ${sqliteConfig.journalMode}`);
  } catch (error) {
    if (sqliteConfig.journalMode !== "WAL" || !isSharedMemoryOpenError(error)) {
      throw error;
    }

    console.warn("SQLite WAL mode is unavailable for DATA_DIR; falling back to DELETE journal mode.");
    database.pragma("locking_mode = EXCLUSIVE");
    database.pragma("journal_mode = DELETE");
  }
}

function isSharedMemoryOpenError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "SQLITE_IOERR_SHMOPEN"
  );
}

sqlite.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'standalone',
  name TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'standalone',
  file_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  cloud_provider TEXT,
  cloud_bucket TEXT,
  cloud_region TEXT,
  cloud_object_key TEXT,
  cloud_status TEXT,
  cloud_error TEXT,
  cloud_uploaded_at TEXT,
  cloud_etag TEXT,
  cloud_request_id TEXT,
  cloud_endpoint TEXT,
  cloud_force_path_style INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS storage_configs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'standalone',
  provider TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  secret_id TEXT,
  secret_key TEXT,
  bucket TEXT,
  region TEXT,
  key_prefix TEXT,
  endpoint_mode TEXT,
  account_id TEXT,
  endpoint TEXT,
  force_path_style INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'standalone',
  source_order_json TEXT NOT NULL,
  local_api_key TEXT,
  local_api_key_id TEXT,
  local_base_url TEXT,
  local_model TEXT,
  local_timeout_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_llm_configs (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'standalone',
  api_key TEXT,
  api_key_id TEXT,
  base_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  timeout_ms INTEGER NOT NULL DEFAULT 60000,
  supports_vision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'standalone',
  title TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  context_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_skills (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'standalone',
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

CREATE TABLE IF NOT EXISTS codex_oauth_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'standalone',
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  email TEXT,
  account_id TEXT,
  expires_at TEXT,
  refreshed_at TEXT,
  unavailable_at TEXT,
  unavailable_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_records (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'standalone',
  mode TEXT NOT NULL,
  prompt TEXT NOT NULL,
  effective_prompt TEXT NOT NULL,
  preset_id TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  quality TEXT NOT NULL,
  output_format TEXT NOT NULL,
  count INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  reference_asset_id TEXT REFERENCES assets(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_outputs (
  id TEXT PRIMARY KEY NOT NULL,
  generation_id TEXT NOT NULL REFERENCES generation_records(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  asset_id TEXT REFERENCES assets(id),
  error TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generation_reference_assets (
  generation_id TEXT NOT NULL REFERENCES generation_records(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (generation_id, position)
);

CREATE INDEX IF NOT EXISTS generation_records_created_at_idx ON generation_records(created_at);
CREATE INDEX IF NOT EXISTS generation_outputs_generation_id_idx ON generation_outputs(generation_id);
CREATE INDEX IF NOT EXISTS generation_outputs_asset_id_idx ON generation_outputs(asset_id);
CREATE INDEX IF NOT EXISTS generation_reference_assets_generation_id_idx ON generation_reference_assets(generation_id);
CREATE INDEX IF NOT EXISTS generation_reference_assets_asset_id_idx ON generation_reference_assets(asset_id);
CREATE INDEX IF NOT EXISTS agent_conversations_updated_at_idx ON agent_conversations(updated_at);
`);

ensureUserIdColumn("projects");
ensureUserIdColumn("assets");
ensureUserIdColumn("storage_configs");
ensureUserIdColumn("provider_configs");
ensureUserIdColumn("agent_llm_configs");
ensureUserIdColumn("agent_conversations");
ensureUserIdColumn("agent_skills");
ensureUserIdColumn("codex_oauth_tokens");
ensureUserIdColumn("generation_records");
dropLegacyAgentSkillSlugIndex();
sqlite.exec(`
CREATE INDEX IF NOT EXISTS generation_records_user_id_idx ON generation_records(user_id);
CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects(user_id);
CREATE INDEX IF NOT EXISTS assets_user_id_idx ON assets(user_id);
CREATE INDEX IF NOT EXISTS storage_configs_user_id_idx ON storage_configs(user_id);
CREATE INDEX IF NOT EXISTS provider_configs_user_id_idx ON provider_configs(user_id);
CREATE INDEX IF NOT EXISTS agent_llm_configs_user_id_idx ON agent_llm_configs(user_id);
CREATE INDEX IF NOT EXISTS agent_conversations_user_id_idx ON agent_conversations(user_id);
CREATE INDEX IF NOT EXISTS agent_skills_user_id_idx ON agent_skills(user_id);
CREATE INDEX IF NOT EXISTS codex_oauth_tokens_user_id_idx ON codex_oauth_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS agent_skills_user_slug_idx ON agent_skills(user_id, slug);
`);
ensureColumn("assets", "cloud_provider", "cloud_provider TEXT");
ensureColumn("assets", "cloud_bucket", "cloud_bucket TEXT");
ensureColumn("assets", "cloud_region", "cloud_region TEXT");
ensureColumn("assets", "cloud_object_key", "cloud_object_key TEXT");
ensureColumn("assets", "cloud_status", "cloud_status TEXT");
ensureColumn("assets", "cloud_error", "cloud_error TEXT");
ensureColumn("assets", "cloud_uploaded_at", "cloud_uploaded_at TEXT");
ensureColumn("assets", "cloud_etag", "cloud_etag TEXT");
ensureColumn("assets", "cloud_request_id", "cloud_request_id TEXT");
ensureColumn("assets", "cloud_endpoint", "cloud_endpoint TEXT");
ensureColumn("assets", "cloud_force_path_style", "cloud_force_path_style INTEGER");
ensureColumn("storage_configs", "endpoint_mode", "endpoint_mode TEXT");
ensureColumn("storage_configs", "account_id", "account_id TEXT");
ensureColumn("storage_configs", "endpoint", "endpoint TEXT");
ensureColumn("storage_configs", "force_path_style", "force_path_style INTEGER");
ensureColumn("codex_oauth_tokens", "access_token", "access_token TEXT");
ensureColumn("codex_oauth_tokens", "refresh_token", "refresh_token TEXT");
ensureColumn("codex_oauth_tokens", "id_token", "id_token TEXT");
ensureColumn("codex_oauth_tokens", "email", "email TEXT");
ensureColumn("codex_oauth_tokens", "account_id", "account_id TEXT");
ensureColumn("codex_oauth_tokens", "expires_at", "expires_at TEXT");
ensureColumn("codex_oauth_tokens", "refreshed_at", "refreshed_at TEXT");
ensureColumn("codex_oauth_tokens", "unavailable_at", "unavailable_at TEXT");
ensureColumn("codex_oauth_tokens", "unavailable_reason", "unavailable_reason TEXT");
ensureColumn("provider_configs", "source_order_json", "source_order_json TEXT NOT NULL DEFAULT '[\"env-openai\",\"local-openai\",\"codex\"]'");
ensureColumn("provider_configs", "local_api_key", "local_api_key TEXT");
ensureColumn("provider_configs", "local_api_key_id", "local_api_key_id TEXT");
ensureColumn("provider_configs", "local_base_url", "local_base_url TEXT");
ensureColumn("provider_configs", "local_model", "local_model TEXT");
ensureColumn("provider_configs", "local_timeout_ms", "local_timeout_ms INTEGER");
ensureColumn("agent_llm_configs", "api_key", "api_key TEXT");
ensureColumn("agent_llm_configs", "api_key_id", "api_key_id TEXT");
ensureColumn("agent_llm_configs", "base_url", "base_url TEXT NOT NULL DEFAULT ''");
ensureColumn("agent_llm_configs", "model", "model TEXT NOT NULL DEFAULT ''");
ensureColumn("agent_llm_configs", "timeout_ms", "timeout_ms INTEGER NOT NULL DEFAULT 60000");
ensureColumn("agent_llm_configs", "supports_vision", "supports_vision INTEGER NOT NULL DEFAULT 0");
ensureColumn("agent_skills", "slug", "slug TEXT NOT NULL DEFAULT ''");
ensureColumn("agent_skills", "name", "name TEXT NOT NULL DEFAULT ''");
ensureColumn("agent_skills", "description", "description TEXT NOT NULL DEFAULT ''");
ensureColumn("agent_skills", "version", "version TEXT");
ensureColumn("agent_skills", "source", "source TEXT");
ensureColumn("agent_skills", "enabled", "enabled INTEGER NOT NULL DEFAULT 1");
ensureColumn("agent_skills", "built_in", "built_in INTEGER NOT NULL DEFAULT 0");
ensureColumn("agent_skills", "is_required", "is_required INTEGER NOT NULL DEFAULT 0");
ensureColumn("agent_skills", "trigger_mode", "trigger_mode TEXT NOT NULL DEFAULT 'auto'");
ensureColumn("agent_skills", "trigger_keywords_json", "trigger_keywords_json TEXT NOT NULL DEFAULT '[]'");
ensureColumn("agent_skills", "files_json", "files_json TEXT NOT NULL DEFAULT '{}'");

migrateStorageConfigRows();
backfillGenerationReferenceAssets();
ensureProviderConfigRow();
ensureAgentLlmConfigRow();

export const db = drizzle(sqlite, { schema });

export function closeDatabase(): void {
  sqlite.close();
}

function ensureColumn(tableName: string, columnName: string, definition: string): void {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

function ensureUserIdColumn(tableName: string): void {
  ensureColumn(tableName, "user_id", "user_id TEXT NOT NULL DEFAULT 'standalone'");
  sqlite.prepare(`UPDATE ${tableName} SET user_id = ? WHERE user_id IS NULL OR user_id = ''`).run("standalone");
}

function dropLegacyAgentSkillSlugIndex(): void {
  const indexes = sqlite.prepare("PRAGMA index_list(agent_skills)").all() as Array<{ name?: string; unique?: number }>;
  const legacySlugIndex = indexes.find((index) => index.name === "agent_skills_slug_idx" && index.unique === 1);
  if (!legacySlugIndex) {
    return;
  }

  sqlite.exec("DROP INDEX agent_skills_slug_idx");
}

function migrateStorageConfigRows(): void {
  const active = sqlite.prepare("SELECT * FROM storage_configs WHERE id = ?").get("active") as StorageConfigSqlRow | undefined;
  if (active) {
    const cos = sqlite.prepare("SELECT id FROM storage_configs WHERE id = ?").get("cos");
    if (!cos) {
      sqlite
        .prepare(
          `INSERT INTO storage_configs
            (id, provider, enabled, secret_id, secret_key, bucket, region, key_prefix, endpoint_mode, account_id, endpoint, force_path_style, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "cos",
          "cos",
          active.enabled,
          active.secret_id,
          active.secret_key,
          active.bucket,
          active.region,
          active.key_prefix,
          null,
          null,
          null,
          null,
          active.created_at,
          active.updated_at
        );
    }

    sqlite.prepare("DELETE FROM storage_configs WHERE id = ?").run("active");
  }

  const enabledRows = sqlite
    .prepare("SELECT id FROM storage_configs WHERE enabled = 1 ORDER BY updated_at DESC, id ASC")
    .all() as Array<{ id: string }>;
  for (const row of enabledRows.slice(1)) {
    sqlite.prepare("UPDATE storage_configs SET enabled = 0 WHERE id = ?").run(row.id);
  }
}

interface StorageConfigSqlRow {
  enabled: number;
  secret_id: string | null;
  secret_key: string | null;
  bucket: string | null;
  region: string | null;
  key_prefix: string | null;
  created_at: string;
  updated_at: string;
}

function backfillGenerationReferenceAssets(): void {
  sqlite.exec(`
    INSERT OR IGNORE INTO generation_reference_assets (generation_id, asset_id, position, created_at)
    SELECT generation_records.id, generation_records.reference_asset_id, 0, generation_records.created_at
    FROM generation_records
    WHERE generation_records.reference_asset_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM assets
        WHERE assets.id = generation_records.reference_asset_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM generation_reference_assets
        WHERE generation_reference_assets.generation_id = generation_records.id
      )
  `);
}

function ensureProviderConfigRow(): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO provider_configs (id, source_order_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    )
    .run("active", JSON.stringify(["env-openai", "local-openai", "codex"]), now, now);
}

function ensureAgentLlmConfigRow(): void {
  const now = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT OR IGNORE INTO agent_llm_configs
        (id, api_key, base_url, model, timeout_ms, supports_vision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run("active", null, "", "", 60000, 0, now, now);
}

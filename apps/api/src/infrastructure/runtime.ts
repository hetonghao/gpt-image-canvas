import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(moduleDir, "../..");
const repoRoot = resolve(packageRoot, "../..");

for (const envPath of [resolve(repoRoot, ".env"), resolve(packageRoot, ".env"), resolve(process.cwd(), ".env")]) {
  loadDotEnv({ path: envPath, quiet: true });
}

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "8787", 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return 8787;
  }
  return parsed;
}

const hostAdapterModes = ["standalone", "ai-cove"] as const;
export type HostAdapterMode = (typeof hostAdapterModes)[number];

function parseHostAdapterMode(value: string | undefined): HostAdapterMode {
  const normalized = value?.trim();
  return hostAdapterModes.includes(normalized as HostAdapterMode) ? (normalized as HostAdapterMode) : "standalone";
}

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const raw = value?.trim() || fallback;
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/+$/u, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return fallback;
  }
}

function resolveFromRepo(value: string): string {
  return isAbsolute(value) ? value : resolve(repoRoot, value);
}

const sqliteJournalModes = ["DELETE", "TRUNCATE", "PERSIST", "MEMORY", "WAL", "OFF"] as const;
type SqliteJournalMode = (typeof sqliteJournalModes)[number];

const sqliteLockingModes = ["NORMAL", "EXCLUSIVE"] as const;
type SqliteLockingMode = (typeof sqliteLockingModes)[number];

function parseSqliteJournalMode(value: string | undefined): SqliteJournalMode {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) {
    return "WAL";
  }

  return sqliteJournalModes.includes(normalized as SqliteJournalMode) ? (normalized as SqliteJournalMode) : "WAL";
}

function parseSqliteLockingMode(value: string | undefined): SqliteLockingMode {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) {
    return "NORMAL";
  }

  return sqliteLockingModes.includes(normalized as SqliteLockingMode) ? (normalized as SqliteLockingMode) : "NORMAL";
}

const dataDir = resolveFromRepo(process.env.DATA_DIR ?? "./data");

export const runtimePaths = {
  repoRoot,
  packageRoot,
  dataDir,
  assetsDir: resolve(dataDir, "assets"),
  assetPreviewsDir: resolve(dataDir, "asset-previews"),
  databaseFile: resolve(dataDir, "gpt-image-canvas.sqlite"),
  webDistDir: resolve(repoRoot, "apps/web/dist")
};

export const serverConfig = {
  host: process.env.HOST ?? "127.0.0.1",
  port: parsePort(process.env.PORT)
};

export const sqliteConfig = {
  journalMode: parseSqliteJournalMode(process.env.SQLITE_JOURNAL_MODE),
  lockingMode: parseSqliteLockingMode(process.env.SQLITE_LOCKING_MODE)
};

export const hostAdapterConfig = {
  mode: parseHostAdapterMode(process.env.HOST_ADAPTER),
  aiCoveApiBaseUrl: normalizeBaseUrl(process.env.AI_COVE_API_BASE_URL, "http://127.0.0.1:8080"),
  aiCovePublicBaseUrl: normalizeBaseUrl(process.env.AI_COVE_PUBLIC_BASE_URL, process.env.AI_COVE_API_BASE_URL?.trim() || "http://127.0.0.1:8080")
};

export function ensureRuntimeStorage(): void {
  mkdirSync(runtimePaths.dataDir, { recursive: true });
  mkdirSync(runtimePaths.assetsDir, { recursive: true });
  mkdirSync(runtimePaths.assetPreviewsDir, { recursive: true });
}

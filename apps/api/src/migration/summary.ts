import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { readAssets, readProjects, DATABASE_FILE_NAME } from "./sqlite.js";
import type { DataSummary } from "./types.js";

type FileDigest = {
  readonly path: string;
  readonly bytes: number;
  readonly digest: string;
};

export function summarizeDataDir(dataDir: string): DataSummary {
  const entries = collectFiles(dataDir).map((path) => {
    const bytes = readFileSync(join(dataDir, path));
    return { path, bytes: bytes.byteLength, digest: hashBytes(bytes) } satisfies FileDigest;
  });
  const databaseEntries = entries.filter(({ path }) => path === DATABASE_FILE_NAME || path.startsWith(`${DATABASE_FILE_NAME}-`));
  const assetEntries = entries.filter(({ path }) => path.startsWith("assets/"));
  const database = new Database(join(dataDir, DATABASE_FILE_NAME), { readonly: true, fileMustExist: true });
  try {
    return {
      directoryDigest: digestEntries(entries),
      databaseDigest: digestEntries(databaseEntries),
      assetDigest: digestEntries(assetEntries),
      fileCount: entries.length,
      byteCount: entries.reduce((total, entry) => total + entry.bytes, 0),
      projectCount: readProjects(database).length,
      assetCount: readAssets(database).length
    };
  } finally {
    database.close();
  }
}

function collectFiles(rootDir: string, prefix = ""): readonly string[] {
  const directory = prefix ? join(rootDir, prefix) : rootDir;
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return collectFiles(rootDir, path);
    if (entry.isFile()) return [path];
    throw new Error(`unsupported data entry: ${path}`);
  });
}

function digestEntries(entries: readonly FileDigest[]): string {
  const normalized = [...entries]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ path, bytes, digest }) => ({ path, bytes, digest }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

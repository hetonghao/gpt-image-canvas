import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import Database from "better-sqlite3";
import { isRecord, numberValue, stringValue } from "./json.js";
import { readAssetRows } from "./assets.js";
import type { AssetRow, ProjectRow, TableFingerprint, TableReconciliation } from "./types.js";

export const DATABASE_FILE_NAME = "gpt-image-canvas.sqlite" as const;

export function openReadonlyDatabase(inputDir: string): Database.Database {
  return new Database(join(inputDir, DATABASE_FILE_NAME), { readonly: true, fileMustExist: true });
}

export function readProjects(database: Database.Database): readonly ProjectRow[] {
  const rows = database.prepare("SELECT id, user_id, snapshot_json FROM projects ORDER BY id").all();
  if (!Array.isArray(rows)) throw new Error("projects query did not return rows");
  return rows.map(parseProjectRow);
}

export function readAssets(database: Database.Database): readonly AssetRow[] {
  return readAssetRows(database);
}

export function ensureAssetIntegrityColumns(database: Database.Database): void {
  const columns = database.prepare("PRAGMA table_info(assets)").all();
  if (!Array.isArray(columns)) throw new Error("assets table info did not return rows");
  const names = new Set(columns.flatMap((row) => {
    if (!isRecord(row)) return [];
    const name = stringValue(row.name);
    return name ? [name] : [];
  }));
  if (!names.has("byte_size")) database.exec("ALTER TABLE assets ADD COLUMN byte_size INTEGER");
  if (!names.has("content_sha256")) database.exec("ALTER TABLE assets ADD COLUMN content_sha256 TEXT");
}

export function databaseIntegrity(database: Database.Database): boolean {
  const integrityRow = database.prepare("PRAGMA integrity_check").get();
  const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
  return isRecord(integrityRow) && integrityRow.integrity_check === "ok" && Array.isArray(foreignKeys) && foreignKeys.length === 0;
}

export function tableFingerprints(database: Database.Database): readonly TableFingerprint[] {
  return tableNames(database).map((name) => {
    const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(name)}`).all();
    const primaryKeyColumns = getPrimaryKeyColumns(database, name);
    return { name, rowCount: Array.isArray(rows) ? rows.length : 0, primaryKeyDigest: primaryKeyDigest(rows, primaryKeyColumns) };
  });
}

export function reconcileTables(input: readonly TableFingerprint[], output: readonly TableFingerprint[]): readonly TableReconciliation[] {
  const outputByName = new Map(output.map((table) => [table.name, table]));
  return input.map((table) => {
    const counterpart = outputByName.get(table.name);
    return {
      ...table,
      outputRowCount: counterpart?.rowCount ?? -1,
      outputPrimaryKeyDigest: counterpart?.primaryKeyDigest ?? null
    };
  });
}

export function tablesMatch(reconciliation: readonly TableReconciliation[]): boolean {
  return reconciliation.every((table) => table.rowCount === table.outputRowCount && table.primaryKeyDigest === table.outputPrimaryKeyDigest);
}

export function canonicalizeAssetFingerprint(
  tables: readonly TableFingerprint[],
  assets: readonly AssetRow[],
  aliases: ReadonlyMap<string, string>
): readonly TableFingerprint[] {
  if (aliases.size === 0) return tables;
  const ids = [...new Set(assets.map((asset) => aliases.get(asset.id) ?? asset.id))].sort();
  const digest = primaryKeyDigest(ids.map((id) => ({ id })), ["id"]);
  return tables.map((table) => table.name === "assets" ? { ...table, rowCount: ids.length, primaryKeyDigest: digest } : table);
}

export function copyInputData(inputDir: string, outputDir: string): void {
  mkdirSync(dirname(outputDir), { recursive: true });
  mkdirSync(outputDir);
  for (const name of ["gpt-image-canvas.sqlite", "gpt-image-canvas.sqlite-wal", "gpt-image-canvas.sqlite-shm", "assets", "asset-previews"]) {
    const source = join(inputDir, name);
    if (existsSync(source)) cpSync(source, join(outputDir, name), { recursive: true, force: false, errorOnExist: true });
  }
}

export function isOutputInsideInput(inputDir: string, outputDir: string): boolean {
  const input = resolve(inputDir);
  const output = resolve(outputDir);
  const path = relative(input, output);
  return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
}

function parseProjectRow(value: unknown): ProjectRow {
  if (!isRecord(value)) throw new Error("project row is not an object");
  const id = stringValue(value.id);
  const userId = stringValue(value.user_id);
  const snapshotJson = stringValue(value.snapshot_json);
  if (!id || !userId || snapshotJson === undefined) throw new Error("project row is invalid");
  return { id, userId, snapshotJson };
}

function tableNames(database: Database.Database): readonly string[] {
  const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  if (!Array.isArray(rows)) throw new Error("sqlite table query did not return rows");
  return rows.flatMap((value) => {
    const name = isRecord(value) ? stringValue(value.name) : undefined;
    return name ? [name] : [];
  });
}

function getPrimaryKeyColumns(database: Database.Database, tableName: string): readonly string[] {
  const rows = database.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
  if (!Array.isArray(rows)) return [];
  return rows
    .flatMap((value) => {
      if (!isRecord(value)) return [];
      const name = stringValue(value.name);
      const pk = numberValue(value.pk);
      return name && pk && pk > 0 ? [{ name, pk }] : [];
    })
    .sort((left, right) => left.pk - right.pk)
    .map((column) => column.name);
}

function primaryKeyDigest(rows: unknown[], columns: readonly string[]): string | null {
  if (columns.length === 0) return null;
  const values = rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    return [columns.map((column) => row[column])];
  });
  values.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

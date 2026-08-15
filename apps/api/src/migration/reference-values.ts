import type Database from "better-sqlite3";
import { isRecord, stringValue } from "./json.js";
import type { AssetRow, BusinessReferenceIssueCode, JsonRecord } from "./types.js";

export type Reference = {
  readonly kind: string;
  readonly owner: string;
  readonly userId: string;
  readonly assetId: string;
};

export function scanAgentConversations(database: Database.Database, assets: ReadonlyMap<string, AssetRow>, outputIds: ReadonlySet<string>, references: Reference[], issues: BusinessReferenceIssueCode[]): void {
  for (const row of tableRows(database, "agent_conversations")) {
    if (!isRecord(row)) {
      issues.push("invalid_reference");
      continue;
    }
    const id = stringValue(row.id);
    const userId = stringValue(row.user_id);
    if (!id || !userId) {
      issues.push("invalid_reference");
      continue;
    }
    for (const value of [row.messages_json, row.context_json]) {
      const parsed = parseJson(value, issues);
      if (parsed !== undefined) scanJson(parsed, `agent-conversation:${id}`, userId, assets, outputIds, references, issues);
    }
  }
}

export function scanJson(value: unknown, owner: string, userId: string, assets: ReadonlyMap<string, AssetRow>, outputIds: ReadonlySet<string>, references: Reference[], issues: BusinessReferenceIssueCode[]): void {
  if (Array.isArray(value)) {
    value.forEach((child) => scanJson(child, owner, userId, assets, outputIds, references, issues));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (isAssetKey(key)) scanAssetValue(child, owner, userId, key, assets, references, issues);
    if (key === "asset" && isRecord(child)) {
      const assetId = normalizeAssetId(stringValue(child.id));
      if (!assetId) issues.push("invalid_reference");
      else addAsset(assetId, owner, userId, "agent-asset", assets, references, issues);
    }
    if (key === "outputId") {
      const outputId = stringValue(child);
      if (outputId && !outputIds.has(outputId)) issues.push("missing_output");
      else if (child !== undefined && child !== null && !outputId) issues.push("invalid_reference");
    }
    if (key === "outputs" && Array.isArray(child)) {
      child.forEach((output) => {
        if (!isRecord(output)) {
          issues.push("invalid_reference");
          return;
        }
        const outputId = stringValue(output.id);
        if (!outputId) issues.push("invalid_reference");
        else if (!outputIds.has(outputId)) issues.push("missing_output");
      });
    }
    scanJson(child, owner, userId, assets, outputIds, references, issues);
  }
}

export function scanOtherTables(database: Database.Database, assets: ReadonlyMap<string, AssetRow>, references: Reference[], issues: BusinessReferenceIssueCode[]): void {
  const skipped = new Set(["projects", "assets", "generation_records", "generation_outputs", "generation_reference_assets", "agent_conversations"]);
  for (const table of tableNames(database)) {
    if (skipped.has(table)) continue;
    const columns = tableColumns(database, table).filter((column) => isAssetColumn(column) || column.toLowerCase() === "asset_url");
    for (const row of tableRows(database, table)) {
      if (!isRecord(row)) {
        issues.push("invalid_reference");
        continue;
      }
      const userId = stringValue(row.user_id) ?? "";
      for (const column of columns) {
        const value = row[column];
        if (column.toLowerCase() === "asset_url") {
          const assetId = assetIdFromUrl(value);
          if (assetId) addAsset(assetId, `${table}:asset-url`, userId, "table-asset-url", assets, references, issues);
        } else {
          scanAssetValue(value, `${table}:asset-reference`, userId, column, assets, references, issues);
        }
      }
    }
  }
}

export function scanAssetValue(value: unknown, owner: string, userId: string, key: string, assets: ReadonlyMap<string, AssetRow>, references: Reference[], issues: BusinessReferenceIssueCode[]): void {
  if (typeof value === "string" && key.toLowerCase().endsWith("_json")) {
    const parsed = parseJson(value, issues);
    if (parsed === undefined) return;
    if (!Array.isArray(parsed)) {
      issues.push("invalid_reference");
      return;
    }
    const itemKey = key.replace(/_json$/u, "");
    parsed.forEach((item) => scanAssetValue(item, owner, userId, itemKey, assets, references, issues));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => scanAssetValue(item, owner, userId, key, assets, references, issues));
    return;
  }
  if (value === null || value === undefined) return;
  const assetId = normalizeAssetId(stringValue(value));
  if (!assetId) {
    issues.push("invalid_reference");
    return;
  }
  addAsset(assetId, owner, userId, key, assets, references, issues);
}

export function addNullableAsset(value: unknown, owner: string, userId: string, kind: string, assets: ReadonlyMap<string, AssetRow>, references: Reference[], issues: BusinessReferenceIssueCode[]): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "string") {
    issues.push("invalid_reference");
    return;
  }
  addAsset(value, owner, userId, kind, assets, references, issues);
}

export function addAsset(assetId: string, owner: string, userId: string, kind: string, assets: ReadonlyMap<string, AssetRow>, references: Reference[], issues: BusinessReferenceIssueCode[]): void {
  const normalized = normalizeAssetId(assetId);
  if (!normalized) {
    issues.push("invalid_reference");
    return;
  }
  checkAsset(normalized, userId, assets, issues);
  if (assets.has(normalized) && (!userId || assets.get(normalized)?.userId === userId)) references.push({ kind, owner, userId, assetId: normalized });
}

export function checkAsset(assetId: string, userId: string, assets: ReadonlyMap<string, AssetRow>, issues: BusinessReferenceIssueCode[]): void {
  const asset = assets.get(assetId);
  if (!asset) issues.push("missing_asset");
  else if (userId && asset.userId !== userId) issues.push("asset_user_mismatch");
}

export function parseJson(value: unknown, issues: BusinessReferenceIssueCode[]): unknown | undefined {
  if (typeof value !== "string") {
    issues.push("invalid_json");
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      issues.push("invalid_json");
      return undefined;
    }
    throw error;
  }
}

export function tableRows(database: Database.Database, table: string): readonly unknown[] {
  if (!tableNames(database).includes(table)) return [];
  const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(table)}`).all();
  return Array.isArray(rows) ? rows : [];
}

function tableNames(database: Database.Database): readonly string[] {
  const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  return Array.isArray(rows) ? rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const name = stringValue(row.name);
    return name ? [name] : [];
  }) : [];
}

function tableColumns(database: Database.Database, table: string): readonly string[] {
  const rows = database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
  return Array.isArray(rows) ? rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const name = stringValue(row.name);
    return name ? [name] : [];
  }) : [];
}

function isAssetKey(key: string): boolean {
  return /^(?:assetId|assetIds|asset_id|asset_ids|referenceAssetId|referenceAssetIds|reference_asset_id|reference_asset_ids)$/u.test(key);
}

function isAssetColumn(column: string): boolean {
  return /(?:^|_)(?:asset_id|asset_ids_json|reference_asset_id|reference_asset_ids_json)$/iu.test(column);
}

function assetIdFromUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.match(/\/api\/assets\/([^/?#]+)/u)?.[1];
}

export function normalizeAssetId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/^asset:/u, "");
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

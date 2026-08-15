import Database from "better-sqlite3";
import { verifyAsset } from "./assets.js";
import { assetReference } from "./elements.js";
import { isRecord, numberValue, stringValue } from "./json.js";
import type { AssetRow, JsonRecord, ProjectResult, VerifiedAsset } from "./types.js";

export type AssetCanonicalization = {
  readonly aliases: ReadonlyMap<string, string>;
  readonly assets: readonly VerifiedAsset[];
  readonly projects: readonly ProjectResult[];
};

export type AssetCanonicalizationOutcome =
  | { readonly kind: "ready"; readonly value: AssetCanonicalization }
  | { readonly kind: "blocked"; readonly code: "asset_missing" | "asset_materialization_failed" };

export async function canonicalizeProjects(
  inputDir: string,
  projects: readonly ProjectResult[],
  sourceAssets: readonly AssetRow[]
): Promise<AssetCanonicalizationOutcome> {
  const verifiedById = new Map<string, VerifiedAsset>();
  for (const project of projects) project.verifiedAssets.forEach((asset) => verifiedById.set(asset.id, asset));
  for (const sourceAsset of sourceAssets) {
    if (verifiedById.has(sourceAsset.id)) continue;
    const verification = await verifyAsset(inputDir, sourceAsset.userId, sourceAsset);
    if (verification.kind === "blocked") return { kind: "blocked", code: verification.code };
    verifiedById.set(sourceAsset.id, verification.value);
  }
  const assets = [...verifiedById.values()].sort(compareAssets);
  const canonicalByContent = new Map<string, string>();
  const canonicalAssets = new Map<string, VerifiedAsset>();
  const aliases = new Map<string, string>();
  for (const asset of assets) {
    const contentKey = `${asset.userId}\u0000${asset.actualContentSha256}`;
    const canonicalId = canonicalByContent.get(contentKey);
    if (canonicalId === undefined) {
      canonicalByContent.set(contentKey, asset.id);
      canonicalAssets.set(asset.id, asset);
    } else if (canonicalId !== asset.id) {
      aliases.set(asset.id, canonicalId);
    }
  }
  return {
    kind: "ready",
    value: {
      aliases,
      assets: [...canonicalAssets.values()],
      projects: projects.map((project) => canonicalProject(project, aliases, canonicalAssets))
    }
  };
}

export function rewriteOutputAssetReferences(database: Database.Database, aliases: ReadonlyMap<string, string>): void {
  const rewrite = database.transaction(() => {
    rewriteAgentConversations(database, aliases);
    rewriteGenericAssetColumns(database, aliases);
    for (const duplicateId of aliases.keys()) {
      if (database.prepare("DELETE FROM assets WHERE id = ?").run(duplicateId).changes !== 1) throw new Error("canonical asset row mismatch");
    }
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS assets_user_content_sha256_idx ON assets(user_id, content_sha256)");
  });
  rewrite();
}

function canonicalProject(project: ProjectResult, aliases: ReadonlyMap<string, string>, canonicalAssets: ReadonlyMap<string, VerifiedAsset>): ProjectResult {
  if (project.status === "blocked" || aliases.size === 0) return project;
  const parsed = rewriteJson(JSON.parse(project.snapshotJson), aliases, false);
  if (!isRecord(parsed) || !isRecord(parsed.assets)) throw new Error("converted project snapshot is invalid");
  for (const [fileId, value] of Object.entries(parsed.assets)) {
    if (!isRecord(value)) throw new Error(`converted asset reference is invalid: ${fileId}`);
    const assetId = stringValue(value.assetId);
    const canonicalId = assetId ? canonicalAssetId(assetId, aliases) : undefined;
    const asset = canonicalId ? canonicalAssets.get(canonicalId) : undefined;
    if (!asset) continue;
    parsed.assets[fileId] = { ...value, ...assetReference(asset) };
  }
  const seen = new Set<string>();
  const verifiedAssets = project.verifiedAssets.flatMap((asset) => {
    const canonical = canonicalAssets.get(canonicalAssetId(asset.id, aliases));
    if (!canonical || seen.has(canonical.id)) return [];
    seen.add(canonical.id);
    return [canonical];
  });
  return { ...project, snapshotJson: JSON.stringify(parsed), verifiedAssets };
}

function rewriteAgentConversations(database: Database.Database, aliases: ReadonlyMap<string, string>): void {
  if (!tableNames(database).includes("agent_conversations")) return;
  const rows = database.prepare("SELECT id, messages_json, context_json FROM agent_conversations").all();
  const update = database.prepare("UPDATE agent_conversations SET messages_json = ?, context_json = ? WHERE id = ?");
  for (const row of rows) {
    if (!isRecord(row)) throw new Error("agent conversation row is invalid");
    const id = stringValue(row.id);
    const messages = rewriteJsonText(row.messages_json, aliases);
    const context = rewriteJsonText(row.context_json, aliases);
    if (!id || messages === undefined || context === undefined) throw new Error("agent conversation reference is invalid");
    update.run(messages, context, id);
  }
}

function rewriteGenericAssetColumns(database: Database.Database, aliases: ReadonlyMap<string, string>): void {
  const skipped = new Set(["projects", "assets", "agent_conversations"]);
  for (const table of tableNames(database)) {
    if (skipped.has(table)) continue;
    for (const column of tableColumns(database, table).filter(isAssetColumn)) {
      const quotedTable = quoteIdentifier(table);
      const quotedColumn = quoteIdentifier(column);
      const rows = database.prepare(`SELECT rowid AS row_id, ${quotedColumn} AS value FROM ${quotedTable}`).all();
      const update = database.prepare(`UPDATE ${quotedTable} SET ${quotedColumn} = ? WHERE rowid = ?`);
      for (const row of rows) {
        if (!isRecord(row)) throw new Error("business reference row is invalid");
        const rowId = numberValue(row.row_id);
        const rewritten = rewriteColumnValue(row.value, column, aliases);
        if (rowId !== undefined && rewritten !== row.value) update.run(rewritten, rowId);
      }
    }
  }
}

function rewriteColumnValue(value: unknown, column: string, aliases: ReadonlyMap<string, string>): unknown {
  if (typeof value !== "string") return value;
  if (column.toLowerCase() === "asset_url") return rewriteAssetUrl(value, aliases);
  if (column.toLowerCase().endsWith("_json")) {
    const parsed: unknown = JSON.parse(value);
    return JSON.stringify(rewriteJson(parsed, aliases, true));
  }
  return rewriteAssetId(value, aliases);
}

function rewriteJsonText(value: unknown, aliases: ReadonlyMap<string, string>): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed: unknown = JSON.parse(value);
  return JSON.stringify(rewriteJson(parsed, aliases, false));
}

function rewriteJson(value: unknown, aliases: ReadonlyMap<string, string>, assetValue: boolean): unknown {
  if (typeof value === "string") {
    const rewrittenUrl = rewriteAssetUrl(value, aliases);
    return assetValue ? rewriteAssetId(rewrittenUrl, aliases) : rewrittenUrl;
  }
  if (Array.isArray(value)) return value.map((child) => rewriteJson(child, aliases, assetValue));
  if (!isRecord(value)) return value;
  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (isAssetKey(key)) result[key] = rewriteJson(child, aliases, true);
    else if (key === "asset" && isRecord(child)) result[key] = { ...child, id: rewriteAssetId(stringValue(child.id), aliases) };
    else result[key] = rewriteJson(child, aliases, false);
  }
  return result;
}

function rewriteAssetUrl(value: string, aliases: ReadonlyMap<string, string>): string {
  let rewritten = value;
  for (const [duplicateId, canonicalId] of aliases) rewritten = rewritten.replaceAll(`/api/assets/${duplicateId}`, `/api/assets/${canonicalId}`);
  return rewritten;
}

function rewriteAssetId(value: string | undefined, aliases: ReadonlyMap<string, string>): string | undefined {
  if (value === undefined) return undefined;
  const prefix = value.startsWith("asset:") ? "asset:" : "";
  const id = value.replace(/^asset:/u, "");
  const canonical = aliases.get(id);
  return canonical === undefined ? value : `${prefix}${canonical}`;
}

function canonicalAssetId(assetId: string, aliases: ReadonlyMap<string, string>): string {
  return aliases.get(assetId) ?? assetId;
}

function compareAssets(left: VerifiedAsset, right: VerifiedAsset): number {
  return `${left.userId}\u0000${left.actualContentSha256}\u0000${left.id}`.localeCompare(`${right.userId}\u0000${right.actualContentSha256}\u0000${right.id}`);
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

function isAssetColumn(column: string): boolean {
  return column.toLowerCase() === "asset_url" || /(?:^|_)(?:asset_id|asset_ids_json|reference_asset_id|reference_asset_ids_json)$/iu.test(column);
}

function isAssetKey(key: string): boolean {
  return /^(?:assetId|assetIds|asset_id|asset_ids|referenceAssetId|referenceAssetIds|reference_asset_id|reference_asset_ids)$/u.test(key);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

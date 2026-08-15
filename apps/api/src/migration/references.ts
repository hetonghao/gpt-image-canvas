import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { assetIdCandidates } from "./assets.js";
import { isRecord, recordValue, stringValue } from "./json.js";
import {
  addAsset,
  addNullableAsset,
  checkAsset,
  normalizeAssetId,
  parseJson,
  scanAgentConversations,
  scanJson,
  scanOtherTables,
  tableRows
} from "./reference-values.js";
import type {
  AssetRow,
  BusinessReferenceIssueCode,
  BusinessReferenceReconciliation,
  JsonRecord,
  ProjectRow
} from "./types.js";

import type { Reference } from "./reference-values.js";

type Scan = {
  readonly references: readonly Reference[];
  readonly issues: readonly BusinessReferenceIssueCode[];
};

export type BusinessReferenceValidation = {
  readonly ok: boolean;
  readonly summary: BusinessReferenceReconciliation;
};

export function reconcileBusinessReferences(input: {
  readonly sourceDatabase: Database.Database;
  readonly outputDatabase: Database.Database;
  readonly sourceProjects: readonly ProjectRow[];
  readonly outputProjects: readonly ProjectRow[];
  readonly sourceAssets: readonly AssetRow[];
  readonly outputAssets: readonly AssetRow[];
  readonly assetAliases?: ReadonlyMap<string, string>;
}): BusinessReferenceValidation {
  const source = scanDatabase(input.sourceDatabase, input.sourceProjects, input.sourceAssets);
  const output = scanDatabase(input.outputDatabase, input.outputProjects, input.outputAssets);
  const sourceReferences = input.assetAliases ? source.references.map((reference) => ({ ...reference, assetId: input.assetAliases?.get(reference.assetId) ?? reference.assetId })) : source.references;
  const summary: BusinessReferenceReconciliation = {
    sourceReferenceCount: sourceReferences.length,
    outputReferenceCount: output.references.length,
    sourceIssueCount: source.issues.length,
    outputIssueCount: output.issues.length,
    sourceIssueCodes: unique(source.issues),
    outputIssueCodes: unique(output.issues),
    sourceDigest: digest(sourceReferences),
    outputDigest: digest(output.references)
  };
  return {
    ok:
      source.issues.length === 0 &&
      output.issues.length === 0 &&
      summary.sourceReferenceCount === summary.outputReferenceCount &&
      summary.sourceDigest === summary.outputDigest,
    summary
  };
}

function scanDatabase(database: Database.Database, projects: readonly ProjectRow[], assets: readonly AssetRow[]): Scan {
  const references: Reference[] = [];
  const issues: BusinessReferenceIssueCode[] = [];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const generationUsers = new Map<string, string>();
  const outputIds = new Set<string>();
  scanGenerationTables(database, assetsById, generationUsers, outputIds, references, issues);
  for (const project of projects) scanProject(project, assetsById, outputIds, references, issues);
  scanAgentConversations(database, assetsById, outputIds, references, issues);
  scanOtherTables(database, assetsById, references, issues);
  return { references, issues };
}

function scanGenerationTables(
  database: Database.Database,
  assets: ReadonlyMap<string, AssetRow>,
  generationUsers: Map<string, string>,
  outputIds: Set<string>,
  references: Reference[],
  issues: BusinessReferenceIssueCode[]
): void {
  for (const row of tableRows(database, "generation_records")) {
    if (!isRecord(row)) {
      issues.push("invalid_reference");
      continue;
    }
    const generationId = stringValue(row.id);
    const userId = stringValue(row.user_id);
    if (!generationId || !userId) {
      issues.push("invalid_reference");
      continue;
    }
    generationUsers.set(generationId, userId);
    addNullableAsset(row.reference_asset_id, `generation-record:${generationId}`, userId, "generation-record-reference", assets, references, issues);
  }
  for (const row of tableRows(database, "generation_outputs")) {
    if (!isRecord(row)) {
      issues.push("invalid_reference");
      continue;
    }
    const outputId = stringValue(row.id);
    const generationId = stringValue(row.generation_id);
    if (!outputId || !generationId) {
      issues.push("invalid_reference");
      continue;
    }
    outputIds.add(outputId);
    const userId = generationUsers.get(generationId);
    if (!userId) issues.push("missing_generation");
    addNullableAsset(row.asset_id, `generation-output:${outputId}`, userId ?? "", "generation-output", assets, references, issues);
  }
  for (const row of tableRows(database, "generation_reference_assets")) {
    if (!isRecord(row)) {
      issues.push("invalid_reference");
      continue;
    }
    const generationId = stringValue(row.generation_id);
    const assetId = stringValue(row.asset_id);
    const userId = generationId ? generationUsers.get(generationId) : undefined;
    if (!generationId || !assetId) issues.push("invalid_reference");
    if (generationId && !userId) issues.push("missing_generation");
    if (assetId) addAsset(assetId, `generation-reference:${generationId ?? "unknown"}`, userId ?? "", "generation-reference", assets, references, issues);
  }
}

function scanProject(project: ProjectRow, assets: ReadonlyMap<string, AssetRow>, outputIds: ReadonlySet<string>, references: Reference[], issues: BusinessReferenceIssueCode[]): void {
  const parsed = parseJson(project.snapshotJson, issues);
  if (!isRecord(parsed)) return;
  if (parsed.format === "ai-cove-excalidraw") {
    scanTargetProject(parsed, project, assets, outputIds, references, issues);
    return;
  }
  scanSourceProject(parsed, project, assets, outputIds, references, issues);
}

function scanTargetProject(project: JsonRecord, row: ProjectRow, assets: ReadonlyMap<string, AssetRow>, outputIds: ReadonlySet<string>, references: Reference[], issues: BusinessReferenceIssueCode[]): void {
  const scene = recordValue(project.scene);
  const mapping = recordValue(project.assets);
  if (!scene || !mapping || !Array.isArray(scene.elements)) {
    issues.push("invalid_reference");
    return;
  }
  const fileAssets = new Map<string, string>();
  for (const [fileId, value] of Object.entries(mapping)) {
    const assetId = isRecord(value) ? normalizeAssetId(stringValue(value.assetId)) : undefined;
    if (!assetId) {
      issues.push("invalid_reference");
      continue;
    }
    fileAssets.set(fileId, assetId);
    checkAsset(assetId, row.userId, assets, issues);
  }
  for (const element of scene.elements) {
    if (!isRecord(element)) {
      issues.push("invalid_reference");
      continue;
    }
    if (element.type === "image") {
      const fileId = stringValue(element.fileId);
      const assetId = fileId ? fileAssets.get(fileId) : undefined;
      if (!assetId) {
        issues.push("missing_asset");
      } else {
        addAsset(assetId, `project:${row.id}`, row.userId, "project-image", assets, references, issues);
      }
    }
    if (isRecord(element.customData)) scanJson(element.customData, `project:${row.id}`, row.userId, assets, outputIds, references, issues);
  }
}

function scanSourceProject(project: JsonRecord, row: ProjectRow, assets: ReadonlyMap<string, AssetRow>, outputIds: ReadonlySet<string>, references: Reference[], issues: BusinessReferenceIssueCode[]): void {
  const document = recordValue(project.document);
  const store = recordValue(document?.store) ?? recordValue(project.store);
  if (!store) {
    issues.push("invalid_json");
    return;
  }
  const sourceAssets = new Map<string, JsonRecord>();
  for (const value of Object.values(store)) {
    if (!isRecord(value) || value.typeName !== "asset") continue;
    const id = stringValue(value.id);
    if (id) sourceAssets.set(id, value);
  }
  for (const value of Object.values(store)) {
    if (!isRecord(value) || value.typeName !== "shape") continue;
    const props = recordValue(value.props);
    if (!props) {
      issues.push("invalid_reference");
      continue;
    }
    if (value.type === "image") {
      const rawAssetId = stringValue(props.assetId);
      const sourceAsset = rawAssetId ? sourceAssets.get(`asset:${rawAssetId.replace(/^asset:/u, "")}`) : undefined;
      const candidates = assetIdCandidates(props, sourceAsset);
      const candidate = candidates.find((value) => assets.has(value)) ?? candidates[0];
      if (!candidate) issues.push("invalid_reference");
      else addAsset(candidate, `project:${row.id}`, row.userId, "project-image", assets, references, issues);
      continue;
    }
    scanJson(props, `project:${row.id}`, row.userId, assets, outputIds, references, issues);
  }
}

function digest(references: readonly Reference[]): string {
  const normalized = references
    .map(({ kind, owner, userId, assetId }) => ({ kind, owner, userId, assetId }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function unique(values: readonly BusinessReferenceIssueCode[]): readonly BusinessReferenceIssueCode[] {
  return [...new Set(values)];
}

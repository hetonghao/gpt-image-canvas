import { join } from "node:path";
import Database from "better-sqlite3";
import { ensureAssetIntegrityColumns } from "./sqlite.js";
import type {
  AssetRow,
  BusinessReferenceReconciliation,
  CheckState,
  FailureCode,
  MigrationCounts,
  ProjectResult,
  ProjectRow,
  TableFingerprint,
  VerifiedAsset,
  WarningCode
} from "./types.js";

export function writeOutputData(outputDir: string, projects: readonly ProjectResult[]): void {
  const database = new Database(join(outputDir, "gpt-image-canvas.sqlite"));
  try {
    database.pragma("foreign_keys = ON");
    ensureAssetIntegrityColumns(database);
    const updateProject = database.prepare("UPDATE projects SET snapshot_json = ? WHERE id = ? AND user_id = ?");
    const updateAsset = database.prepare("UPDATE assets SET mime_type = ?, byte_size = ?, content_sha256 = ? WHERE id = ? AND user_id = ?");
    const verifiedAssets = new Map<string, VerifiedAsset>();
    for (const project of projects) project.verifiedAssets.forEach((asset) => verifiedAssets.set(asset.id, asset));
    const write = database.transaction(() => {
      for (const project of projects) {
        if (project.status === "blocked" || updateProject.run(project.snapshotJson, project.id, project.userId).changes !== 1) throw new Error("output project row mismatch");
      }
      for (const asset of verifiedAssets.values()) {
        if (updateAsset.run(asset.mimeType, asset.actualByteSize, asset.actualContentSha256, asset.id, asset.userId).changes !== 1) throw new Error("output asset row mismatch");
      }
    });
    write();
  } finally {
    database.close();
  }
}

export function migrationCounts(projects: readonly ProjectResult[], tables: readonly TableFingerprint[]): MigrationCounts {
  const validatedAssets = new Set(projects.flatMap((project) => project.verifiedAssets.map((asset) => asset.id)));
  return {
    inputProjects: projects.length,
    convertedProjects: projects.filter((project) => project.status === "converted").length,
    failedProjects: projects.filter((project) => project.status === "blocked").length,
    warningProjects: projects.filter((project) => project.warnings.length > 0).length,
    inputShapes: projects.reduce((total, project) => total + project.sourceShapeCount, 0),
    outputElements: projects.reduce((total, project) => total + project.targetElementCount, 0),
    assetReferences: projects.reduce((total, project) => total + project.assetReferences, 0),
    validatedAssets: validatedAssets.size,
    nonSceneTables: tables.filter((table) => table.name !== "projects").length
  };
}

export function migrationWarnings(projects: readonly ProjectResult[], assets: readonly AssetRow[]): readonly WarningCode[] {
  const warnings = new Set<WarningCode>(projects.flatMap((project) => project.warnings));
  if (projects.every((project) => project.status === "converted")) {
    const usedAssetIds = new Set(projects.flatMap((project) => project.verifiedAssets.map((asset) => asset.id)));
    if (assets.some((asset) => !usedAssetIds.has(asset.id))) warnings.add("orphan_asset_record");
  }
  return [...warnings];
}

export function assetCheckState(failures: readonly FailureCode[]): CheckState {
  return failures.some((code) => code === "asset_missing" || code === "asset_materialization_failed") ? "failed" : "skipped";
}

export function sameProjects(left: readonly ProjectRow[], right: readonly ProjectRow[]): boolean {
  return left.length === right.length && left.every((project, index) => {
    const counterpart = right[index];
    return counterpart?.id === project.id && counterpart.userId === project.userId && counterpart.snapshotJson === project.snapshotJson;
  });
}

export function emptyCounts(): MigrationCounts {
  return {
    inputProjects: 0,
    convertedProjects: 0,
    failedProjects: 0,
    warningProjects: 0,
    inputShapes: 0,
    outputElements: 0,
    assetReferences: 0,
    validatedAssets: 0,
    nonSceneTables: 0
  };
}

export function emptyBusinessReferenceReconciliation(): BusinessReferenceReconciliation {
  return {
    sourceReferenceCount: 0,
    outputReferenceCount: 0,
    sourceIssueCount: 0,
    outputIssueCount: 0,
    sourceIssueCodes: [],
    outputIssueCodes: [],
    sourceDigest: "",
    outputDigest: ""
  };
}

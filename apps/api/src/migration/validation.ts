import { join } from "node:path";
import Database from "better-sqlite3";
import { verifyAsset } from "./assets.js";
import { isRecord, numberValue, recordValue, stringValue } from "./json.js";
import { reconcileBusinessReferences } from "./references.js";
import {
  DATABASE_FILE_NAME,
  databaseIntegrity,
  readAssets,
  readProjects,
  reconcileTables,
  tableFingerprints,
  tablesMatch
} from "./sqlite.js";
import type { BusinessReferenceReconciliation, CheckState, FailureCode, ProjectResult, TableFingerprint, TableReconciliation } from "./types.js";

export type OutputValidation = {
  readonly databaseIntegrity: CheckState;
  readonly assetValidation: CheckState;
  readonly reopenValidation: CheckState;
  readonly businessReferenceValidation: CheckState;
  readonly businessReferenceReconciliation: BusinessReferenceReconciliation;
  readonly tableReconciliation: readonly TableReconciliation[];
  readonly failures: readonly FailureCode[];
};

export async function validateOutput(input: {
  readonly inputDir: string;
  readonly outputDir: string;
  readonly sourceTables: readonly TableFingerprint[];
  readonly projects: readonly ProjectResult[];
}): Promise<OutputValidation> {
  let sourceDatabase: Database.Database | undefined;
  let database: Database.Database | undefined;
  try {
    sourceDatabase = new Database(join(input.inputDir, DATABASE_FILE_NAME), { readonly: true, fileMustExist: true });
    database = new Database(join(input.outputDir, DATABASE_FILE_NAME), { readonly: true, fileMustExist: true });
    const integrity = databaseIntegrity(database);
    const outputTables = tableFingerprints(database);
    const reconciliation = reconcileTables(input.sourceTables, outputTables);
    const tablesAreEqual = sameTableNames(input.sourceTables, outputTables) && tablesMatch(reconciliation);
    const outputProjects = readProjects(database);
    const outputAssets = readAssets(database);
    const sourceProjects = readProjects(sourceDatabase);
    const sourceAssets = readAssets(sourceDatabase);
    const assetsAreValid = await validateAssets(input.outputDir, input.projects, outputAssets);
    const projectsAreValid = validateProjects(input.projects, outputProjects, outputAssets);
    const businessReferences = reconcileBusinessReferences({
      sourceDatabase,
      outputDatabase: database,
      sourceProjects,
      outputProjects,
      sourceAssets,
      outputAssets
    });
    const failures: FailureCode[] = [];
    if (!integrity || !tablesAreEqual) failures.push("database_reconciliation_failed");
    if (!assetsAreValid) failures.push("asset_materialization_failed");
    if (!projectsAreValid) failures.push("reopen_mismatch");
    if (!businessReferences.ok) failures.push("business_reference_reconciliation_failed");
    return {
      databaseIntegrity: integrity && tablesAreEqual ? "ok" : "failed",
      assetValidation: assetsAreValid ? "ok" : "failed",
      reopenValidation: projectsAreValid ? "ok" : "failed",
      businessReferenceValidation: businessReferences.ok ? "ok" : "failed",
      businessReferenceReconciliation: businessReferences.summary,
      tableReconciliation: reconciliation,
      failures
    };
  } catch (error) {
    if (error instanceof Error) {
      return {
        databaseIntegrity: "failed",
        assetValidation: "failed",
        reopenValidation: "failed",
        businessReferenceValidation: "failed",
        businessReferenceReconciliation: emptyBusinessReferenceReconciliation(),
        tableReconciliation: [],
        failures: ["reopen_mismatch"]
      };
    }
    throw error;
  } finally {
    sourceDatabase?.close();
    database?.close();
  }
}

function emptyBusinessReferenceReconciliation(): BusinessReferenceReconciliation {
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

function sameTableNames(input: readonly TableFingerprint[], output: readonly TableFingerprint[]): boolean {
  return input.length === output.length && input.every((table, index) => table.name === output[index]?.name);
}

async function validateAssets(
  outputDir: string,
  projects: readonly ProjectResult[],
  outputAssets: ReturnType<typeof readAssets>
): Promise<boolean> {
  const assetsById = new Map(outputAssets.map((asset) => [asset.id, asset]));
  const checks = new Map<string, ReturnType<typeof verifyAsset>>();
  for (const project of projects) {
    if (project.status === "blocked") return false;
    for (const expected of project.verifiedAssets) {
      const asset = assetsById.get(expected.id);
      if (!asset || asset.userId !== project.userId) return false;
      let check = checks.get(asset.id);
      if (!check) {
        check = verifyAsset(outputDir, project.userId, asset);
        checks.set(asset.id, check);
      }
      if ((await check).kind === "blocked") return false;
    }
  }
  return true;
}

function validateProjects(
  expectedProjects: readonly ProjectResult[],
  outputProjects: ReturnType<typeof readProjects>,
  outputAssets: ReturnType<typeof readAssets>
): boolean {
  if (expectedProjects.some((project) => project.status === "blocked")) return false;
  const outputByKey = new Map(outputProjects.map((project) => [projectKey(project.id, project.userId), project]));
  const assetsById = new Map(outputAssets.map((asset) => [asset.id, asset]));
  return expectedProjects.every((project) => {
    if (project.status === "blocked") return false;
    const output = outputByKey.get(projectKey(project.id, project.userId));
    return output !== undefined && output.snapshotJson === project.snapshotJson && isTargetSnapshot(output.snapshotJson, assetsById);
  });
}

function isTargetSnapshot(snapshotJson: string, assetsById: ReadonlyMap<string, ReturnType<typeof readAssets>[number]>): boolean {
  try {
    const parsed: unknown = JSON.parse(snapshotJson);
    if (!isRecord(parsed) || parsed.format !== "ai-cove-excalidraw" || parsed.version !== 1) return false;
    const scene = recordValue(parsed.scene);
    const elements = scene?.elements;
    const appState = scene?.appState;
    const references = recordValue(parsed.assets);
    if (!scene || !Array.isArray(elements) || !recordValue(appState) || !references) return false;
    for (const [fileId, value] of Object.entries(references)) {
      if (!validAssetReference(fileId, value, assetsById)) return false;
    }
    for (const value of elements) {
      if (!isRecord(value)) return false;
      if (value.type === "image") {
        const fileId = stringValue(value.fileId);
        if (!fileId || !validAssetReference(fileId, references[fileId], assetsById)) return false;
      }
    }
    return true;
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

function validAssetReference(
  fileId: string,
  value: unknown,
  assetsById: ReadonlyMap<string, ReturnType<typeof readAssets>[number]>
): boolean {
  if (!fileId || !isRecord(value)) return false;
  const assetId = stringValue(value.assetId);
  const asset = assetId ? assetsById.get(assetId) : undefined;
  if (!asset) return false;
  const byteSize = nullableNumber(value.byteSize);
  const contentSha256 = nullableString(value.contentSha256);
  return (
    stringValue(value.fileName) === asset.fileName &&
    stringValue(value.mimeType) === asset.mimeType &&
    numberValue(value.width) === asset.width &&
    numberValue(value.height) === asset.height &&
    byteSize === asset.byteSize &&
    contentSha256 === asset.contentSha256
  );
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null ? null : numberValue(value);
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : stringValue(value);
}

function projectKey(id: string, userId: string): string {
  return `${userId}\u0000${id}`;
}

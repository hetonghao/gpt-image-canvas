import { join } from "node:path";
import Database from "better-sqlite3";
import { verifyAsset } from "./assets.js";
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
import { reopenTargetProject } from "./target-reopen.js";
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
    const projectsAreValid = await validateProjects({ outputDir: input.outputDir, expectedProjects: input.projects, outputProjects, outputAssets });
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

async function validateProjects(input: {
  readonly outputDir: string;
  readonly expectedProjects: readonly ProjectResult[];
  readonly outputProjects: ReturnType<typeof readProjects>;
  readonly outputAssets: ReturnType<typeof readAssets>;
}): Promise<boolean> {
  if (input.expectedProjects.some((project) => project.status === "blocked")) return false;
  const outputByKey = new Map(input.outputProjects.map((project) => [projectKey(project.id, project.userId), project]));
  for (const project of input.expectedProjects) {
    if (project.status === "blocked") return false;
    const output = outputByKey.get(projectKey(project.id, project.userId));
    if (!output || output.snapshotJson !== project.snapshotJson) return false;
    const reopened = await reopenTargetProject({
      outputDir: input.outputDir,
      userId: output.userId,
      snapshotJson: output.snapshotJson,
      assets: input.outputAssets
    });
    if (!reopened) return false;
  }
  return true;
}

function projectKey(id: string, userId: string): string {
  return `${userId}\u0000${id}`;
}

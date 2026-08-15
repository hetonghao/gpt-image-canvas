import { existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { convertProject } from "./converter.js";
import {
  assetCheckState,
  emptyBusinessReferenceReconciliation,
  emptyCounts,
  migrationCounts,
  migrationWarnings,
  sameProjects,
  writeOutputData
} from "./migration-support.js";
import { buildMigrationReport, writeMigrationReport } from "./report.js";
import {
  copyInputData,
  DATABASE_FILE_NAME,
  databaseIntegrity,
  isOutputInsideInput,
  openReadonlyDatabase,
  readAssets,
  readProjects,
  tableFingerprints
} from "./sqlite.js";
import { validateOutput } from "./validation.js";
import type {
  AssetRow,
  BusinessReferenceReconciliation,
  CheckState,
  ConversionOutcome,
  FailureCode,
  MigrationCounts,
  MigrationOptions,
  MigrationReport,
  ProjectResult,
  ProjectRow,
  TableReconciliation,
  WarningCode
} from "./types.js";

type MigrationPaths = {
  readonly inputDir: string;
  readonly outputDir: string;
  readonly reportDir: string;
};

type ReportInput = {
  readonly paths: MigrationPaths;
  readonly options: MigrationOptions;
  readonly counts: MigrationCounts;
  readonly databaseIntegrity: CheckState;
  readonly assetValidation: CheckState;
  readonly reopenValidation: CheckState;
  readonly businessReferenceValidation: CheckState;
  readonly businessReferenceReconciliation: BusinessReferenceReconciliation;
  readonly tableReconciliation: readonly TableReconciliation[];
  readonly projectResults: readonly ProjectResult[];
  readonly failureCodes: readonly FailureCode[];
  readonly warningCodes: readonly WarningCode[];
};

export async function runOfflineMigration(options: MigrationOptions): Promise<MigrationReport> {
  const paths = resolvePaths(options);
  const pathFailure = validatePaths(paths);
  if (pathFailure) return finishReport(blockedReportInput(paths, options, pathFailure));
  if (existsSync(paths.outputDir)) return finishReport(blockedReportInput(paths, options, "output_protected"));

  let source: Database.Database | undefined;
  let phase: "input" | "copy" | "write" | "validate" = "input";
  try {
    source = openReadonlyDatabase(paths.inputDir);
    if (!databaseIntegrity(source)) {
      return finishReport({
        ...blockedReportInput(paths, options, "source_integrity_failed"),
        databaseIntegrity: "failed"
      });
    }
    const sourceTables = tableFingerprints(source);
    const sourceProjects = readProjects(source);
    const sourceAssets = readAssets(source);
    const projectResults = await convertProjects(paths.inputDir, sourceProjects, sourceAssets);
    const counts = migrationCounts(projectResults, sourceTables);
    const warningCodes = migrationWarnings(projectResults, sourceAssets);
    const projectFailures = projectResults.flatMap((project) => project.status === "blocked" ? project.failures : []);
    if (!sameProjects(sourceProjects, readProjects(source))) {
      return finishReport({
        paths,
        options,
        counts,
        databaseIntegrity: "failed",
        assetValidation: "skipped",
        reopenValidation: "skipped",
        businessReferenceValidation: "skipped",
        businessReferenceReconciliation: emptyBusinessReferenceReconciliation(),
        tableReconciliation: [],
        projectResults,
        failureCodes: [...projectFailures, "source_integrity_failed"],
        warningCodes
      });
    }
    if (projectFailures.length > 0) {
      return finishReport({
        paths,
        options,
        counts,
        databaseIntegrity: "ok",
        assetValidation: assetCheckState(projectFailures),
        reopenValidation: "skipped",
        businessReferenceValidation: "skipped",
        businessReferenceReconciliation: emptyBusinessReferenceReconciliation(),
        tableReconciliation: [],
        projectResults,
        failureCodes: projectFailures,
        warningCodes
      });
    }
    source.close();
    source = undefined;

    phase = "copy";
    copyInputData(paths.inputDir, paths.outputDir);
    phase = "write";
    writeOutputData(paths.outputDir, projectResults);
    phase = "validate";
    const validation = await validateOutput({ inputDir: paths.inputDir, outputDir: paths.outputDir, sourceTables, projects: projectResults });
    const failureCodes = [...validation.failures];
    if (warningCodes.length > 0 && options.approveWarnings !== true) failureCodes.push("warning_unapproved");
    return finishReport({
      paths,
      options,
      counts,
      databaseIntegrity: validation.databaseIntegrity,
      assetValidation: validation.assetValidation,
      reopenValidation: validation.reopenValidation,
      businessReferenceValidation: validation.businessReferenceValidation,
      businessReferenceReconciliation: validation.businessReferenceReconciliation,
      tableReconciliation: validation.tableReconciliation,
      projectResults,
      failureCodes,
      warningCodes
    });
  } catch (error) {
    if (error instanceof Error) {
      const code: FailureCode = phase === "copy" ? "copy_failed" : phase === "write" ? "database_reconciliation_failed" : phase === "validate" ? "reopen_mismatch" : "input_invalid";
      return finishReport(blockedReportInput(paths, options, code));
    }
    throw error;
  } finally {
    source?.close();
  }
}

function resolvePaths(options: MigrationOptions): MigrationPaths {
  const outputDir = resolve(options.outputDir);
  return {
    inputDir: resolve(options.inputDir),
    outputDir,
    reportDir: resolve(options.reportDir ?? join(dirname(outputDir), `${basename(outputDir)}-report`))
  };
}

function validatePaths(paths: MigrationPaths): FailureCode | undefined {
  if (!paths.inputDir || !paths.outputDir || !existsSync(paths.inputDir) || !statSync(paths.inputDir).isDirectory()) return "input_invalid";
  if (!existsSync(join(paths.inputDir, DATABASE_FILE_NAME))) return "input_invalid";
  if (isOutputInsideInput(paths.inputDir, paths.outputDir) || isOutputInsideInput(paths.inputDir, paths.reportDir) || paths.outputDir === paths.reportDir) return "input_invalid";
  return undefined;
}

function blockedReportInput(paths: MigrationPaths, options: MigrationOptions, failureCode: FailureCode): ReportInput {
  return {
    paths,
    options,
    counts: emptyCounts(),
    databaseIntegrity: "skipped",
    assetValidation: "skipped",
    reopenValidation: "skipped",
    businessReferenceValidation: "skipped",
    businessReferenceReconciliation: emptyBusinessReferenceReconciliation(),
    tableReconciliation: [],
    projectResults: [],
    failureCodes: [failureCode],
    warningCodes: []
  };
}

function finishReport(input: ReportInput): MigrationReport {
  const report = buildMigrationReport({
    inputDir: input.paths.inputDir,
    outputDir: input.paths.outputDir,
    reportDir: input.paths.reportDir,
    sourceBackupId: input.options.sourceBackupId,
    counts: input.counts,
    databaseIntegrity: input.databaseIntegrity,
    assetValidation: input.assetValidation,
    reopenValidation: input.reopenValidation,
    businessReferenceValidation: input.businessReferenceValidation,
    businessReferenceReconciliation: input.businessReferenceReconciliation,
    tableReconciliation: input.tableReconciliation,
    projectResults: input.projectResults,
    failureCodes: input.failureCodes,
    warningCodes: input.warningCodes,
    warningsApproved: input.options.approveWarnings === true
  });
  writeMigrationReport(report);
  return report;
}

async function convertProjects(inputDir: string, projects: readonly ProjectRow[], assets: readonly AssetRow[]): Promise<readonly ProjectResult[]> {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const results: ProjectResult[] = [];
  for (const project of projects) {
    const outcome: ConversionOutcome = await convertProject(inputDir, project, assetsById);
    results.push(outcome.kind === "converted" ? { ...outcome.value, status: "converted" } : { ...outcome.value, status: "blocked" });
  }
  return results;
}

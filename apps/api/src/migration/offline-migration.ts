import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { canonicalizeProjects, rewriteOutputAssetReferences } from "./asset-canonicalization.js";
import { convertProject } from "./converter.js";
import {
  assetCheckState,
  emptyBusinessReferenceReconciliation,
  migrationCounts,
  migrationWarnings,
  sameProjects,
  writeOutputData
} from "./migration-support.js";
import { buildMigrationReport, hasBindingFacts, sourceBackupDigestMatches, writeMigrationReport } from "./report.js";
import { resolveMigrationPaths, validateMigrationPaths, type MigrationPaths } from "./offline-paths.js";
import { blockedReportInput, type MigrationReportInput } from "./offline-report-input.js";
import { summarizeDataDir } from "./summary.js";
import {
  copyInputData,
  DATABASE_FILE_NAME,
  databaseIntegrity,
  openReadonlyDatabase,
  readAssets,
  readProjects,
  tableFingerprints
} from "./sqlite.js";
import { validateOutput } from "./validation.js";
import type {
  AssetRow,
  ConversionOutcome,
  DataSummary,
  FailureCode,
  MigrationOptions,
  MigrationReport,
  ProjectResult,
  ProjectRow
} from "./types.js";

export async function runOfflineMigration(options: MigrationOptions): Promise<MigrationReport> {
  const paths = resolveMigrationPaths(options);
  const pathFailure = validateMigrationPaths(paths);
  if (pathFailure) return finishReport(blockedReportInput(paths, options, pathFailure));
  if (!hasBindingFacts(options)) return finishReport(blockedReportInput(paths, options, "report_binding_missing"));
  if (existsSync(paths.outputDir)) return finishReport(blockedReportInput(paths, options, "output_protected"));

  let source: Database.Database | undefined;
  let inputSummary: DataSummary | null = null;
  let outputSummary: DataSummary | null = null;
  let phase: "input" | "copy" | "write" | "validate" = "input";
  try {
    source = openReadonlyDatabase(paths.inputDir);
    if (!databaseIntegrity(source)) {
      return finishReport({
        ...blockedReportInput(paths, options, "source_integrity_failed"),
        databaseIntegrity: "failed"
      });
    }
    const initialInputSummary = summarizeDataDir(paths.inputDir);
    inputSummary = initialInputSummary;
    if (!sourceBackupDigestMatches(options.sourceBackupDigest, initialInputSummary)) {
      return finishReport(blockedReportInput(paths, options, "source_backup_digest_mismatch", inputSummary));
    }
    const sourceTables = tableFingerprints(source);
    const sourceProjects = readProjects(source);
    const sourceAssets = readAssets(source);
    const projectResults = await convertProjects(paths.inputDir, sourceProjects, sourceAssets);
    const projectFailures = projectResults.flatMap((project) => project.status === "blocked" ? project.failures : []);
    const preCanonicalCounts = migrationCounts(projectResults, sourceTables);
    const preCanonicalWarnings = migrationWarnings(projectResults, sourceAssets);
    const sourceAfterSummary = summarizeDataDir(paths.inputDir);
    if (!sameProjects(sourceProjects, readProjects(source)) || sourceAfterSummary.directoryDigest !== initialInputSummary.directoryDigest) {
      return finishReport({
        paths,
        options,
        inputSummary,
        outputSummary,
        counts: preCanonicalCounts,
        databaseIntegrity: "failed",
        assetValidation: "skipped",
        reopenValidation: "skipped",
        businessReferenceValidation: "skipped",
        businessReferenceReconciliation: emptyBusinessReferenceReconciliation(),
        tableReconciliation: [],
        projectResults,
        failureCodes: [...projectFailures, "source_integrity_failed"],
        warningCodes: preCanonicalWarnings
      });
    }
    if (projectFailures.length > 0) {
      return finishReport({
        paths,
        options,
        inputSummary,
        outputSummary,
        counts: preCanonicalCounts,
        databaseIntegrity: "ok",
        assetValidation: assetCheckState(projectFailures),
        reopenValidation: "skipped",
        businessReferenceValidation: "skipped",
        businessReferenceReconciliation: emptyBusinessReferenceReconciliation(),
        tableReconciliation: [],
        projectResults,
        failureCodes: projectFailures,
        warningCodes: preCanonicalWarnings
      });
    }
    source.close();
    source = undefined;

    const canonicalization = await canonicalizeProjects(paths.inputDir, projectResults, sourceAssets);
    if (canonicalization.kind === "blocked") {
      return finishReport({
        paths,
        options,
        inputSummary,
        outputSummary,
        counts: migrationCounts(projectResults, sourceTables),
        databaseIntegrity: "ok",
        assetValidation: "failed",
        reopenValidation: "skipped",
        businessReferenceValidation: "skipped",
        businessReferenceReconciliation: emptyBusinessReferenceReconciliation(),
        tableReconciliation: [],
        projectResults,
        failureCodes: [canonicalization.code],
        warningCodes: []
      });
    }
    const migratedProjects = canonicalization.value.projects;
    const counts = migrationCounts(migratedProjects, sourceTables);
    const warningCodes = migrationWarnings(migratedProjects, sourceAssets, canonicalization.value.aliases);

    phase = "copy";
    copyInputData(paths.inputDir, paths.outputDir);
    phase = "write";
    writeOutputData(paths.outputDir, migratedProjects, canonicalization.value.assets);
    const outputDatabase = new Database(join(paths.outputDir, DATABASE_FILE_NAME));
    try {
      rewriteOutputAssetReferences(outputDatabase, canonicalization.value.aliases);
    } finally {
      outputDatabase.close();
    }
    outputSummary = summarizeDataDir(paths.outputDir);
    phase = "validate";
    const validation = await validateOutput({ inputDir: paths.inputDir, outputDir: paths.outputDir, sourceTables, projects: migratedProjects, assetAliases: canonicalization.value.aliases });
    const failureCodes = [...validation.failures];
    if (warningCodes.length > 0 && options.approveWarnings !== true) failureCodes.push("warning_unapproved");
    return finishReport({
      paths,
      options,
      inputSummary,
      outputSummary,
      counts,
      databaseIntegrity: validation.databaseIntegrity,
      assetValidation: validation.assetValidation,
      reopenValidation: validation.reopenValidation,
      businessReferenceValidation: validation.businessReferenceValidation,
      businessReferenceReconciliation: validation.businessReferenceReconciliation,
      tableReconciliation: validation.tableReconciliation,
      projectResults: migratedProjects,
      failureCodes,
      warningCodes
    });
  } catch (error) {
    if (error instanceof Error) {
      const code: FailureCode = phase === "copy" ? "copy_failed" : phase === "write" ? "database_reconciliation_failed" : phase === "validate" ? "reopen_mismatch" : "input_invalid";
      return finishReport(blockedReportInput(paths, options, code, inputSummary, outputSummary));
    }
    throw error;
  } finally {
    source?.close();
  }
}

function finishReport(input: MigrationReportInput): MigrationReport {
  const build = (failureCodes: readonly FailureCode[]): MigrationReport => buildMigrationReport({
    inputDir: input.paths.inputDir,
    outputDir: input.paths.outputDir,
    reportDir: input.paths.reportDir,
    sourceBackupId: input.options.sourceBackupId,
    sourceBackupDigest: input.options.sourceBackupDigest,
    toolCommit: input.options.toolCommit,
    candidateImageDigest: input.options.candidateImageDigest,
    inputSummary: input.inputSummary,
    outputSummary: input.outputSummary,
    counts: input.counts,
    databaseIntegrity: input.databaseIntegrity,
    assetValidation: input.assetValidation,
    reopenValidation: input.reopenValidation,
    businessReferenceValidation: input.businessReferenceValidation,
    businessReferenceReconciliation: input.businessReferenceReconciliation,
    tableReconciliation: input.tableReconciliation,
    projectResults: input.projectResults,
    failureCodes,
    warningCodes: input.warningCodes,
    warningsApproved: input.options.approveWarnings === true
  });
  const report = build(input.failureCodes);
  if (writeMigrationReport(report) || report.failureCodes.includes("report_protected")) return report;
  return build([...input.failureCodes, "report_protected"]);
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

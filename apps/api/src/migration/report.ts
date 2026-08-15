import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  MIGRATION_TOOL_VERSION,
  type FailureCode,
  type BusinessReferenceReconciliation,
  type DataSummary,
  type MigrationCounts,
  type MigrationOptions,
  type MigrationReport,
  type ProjectResult,
  type ReportProjectResult,
  type TableReconciliation,
  type WarningCode
} from "./types.js";

export function buildMigrationReport(input: {
  readonly inputDir: string;
  readonly outputDir: string;
  readonly reportDir: string;
  readonly sourceBackupId?: string;
  readonly sourceBackupDigest?: string;
  readonly toolCommit?: string;
  readonly candidateImageDigest?: string;
  readonly inputSummary: DataSummary | null;
  readonly outputSummary: DataSummary | null;
  readonly counts: MigrationCounts;
  readonly databaseIntegrity: MigrationReport["databaseIntegrity"];
  readonly assetValidation: MigrationReport["assetValidation"];
  readonly reopenValidation: MigrationReport["reopenValidation"];
  readonly businessReferenceValidation: MigrationReport["businessReferenceValidation"];
  readonly businessReferenceReconciliation: BusinessReferenceReconciliation;
  readonly tableReconciliation: readonly TableReconciliation[];
  readonly projectResults: readonly ProjectResult[];
  readonly failureCodes: readonly FailureCode[];
  readonly warningCodes: readonly WarningCode[];
  readonly warningsApproved: boolean;
}): MigrationReport {
  const bindingFailure = releaseBindingFailure(input);
  const bindingReady = bindingFailure === undefined;
  const bindingFailures: readonly FailureCode[] = bindingFailure === undefined ? [] : [bindingFailure];
  const failureCodes = unique([...input.failureCodes, ...bindingFailures]);
  const status = failureCodes.length === 0 && (input.warningCodes.length === 0 || input.warningsApproved) ? "ready" : "blocked";
  return {
    status,
    toolVersion: MIGRATION_TOOL_VERSION,
    sourceBackupIdHash: input.sourceBackupId ? hash(input.sourceBackupId) : null,
    sourceBackupDigest: input.sourceBackupDigest ?? null,
    toolCommit: input.toolCommit ?? null,
    candidateImageDigest: input.candidateImageDigest ?? null,
    inputSummary: input.inputSummary,
    outputSummary: input.outputSummary,
    reportBindingValidation: bindingReady ? "ok" : "failed",
    inputLabel: basename(input.inputDir),
    outputLabel: basename(input.outputDir),
    counts: input.counts,
    databaseIntegrity: input.databaseIntegrity,
    assetValidation: input.assetValidation,
    reopenValidation: input.reopenValidation,
    businessReferenceValidation: input.businessReferenceValidation,
    businessReferenceReconciliation: input.businessReferenceReconciliation,
    tableReconciliation: input.tableReconciliation,
    projectResults: input.projectResults.map(toReportProject),
    failureCodes,
    warningCodes: unique(input.warningCodes),
    warningsApproved: input.warningsApproved,
    reportFiles: {
      machine: join(input.reportDir, "migration-report.json"),
      human: join(input.reportDir, "migration-summary.txt")
    }
  };
}

export function writeMigrationReport(report: MigrationReport): boolean {
  const reportDir = dirname(report.reportFiles.machine);
  if (existsSync(reportDir)) return false;
  mkdirSync(reportDir, { recursive: true });
  try {
    writeFileSync(report.reportFiles.machine, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    writeFileSync(report.reportFiles.human, humanSummary(report), { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (isAlreadyExists(error)) return false;
    throw error;
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function humanSummary(report: MigrationReport): string {
  const status = report.status === "ready" ? "READY" : "BLOCKED";
  const lines = [
    `AI Cove Excalidraw 离线迁移：${status}`,
    `工具版本：${report.toolVersion}`,
    `项目：输入 ${report.counts.inputProjects}，成功 ${report.counts.convertedProjects}，失败 ${report.counts.failedProjects}`,
    `元素：输入 ${report.counts.inputShapes}，输出 ${report.counts.outputElements}`,
    `资产引用：${report.counts.assetReferences}，已校验资产：${report.counts.validatedAssets}`,
    `发布绑定：${report.reportBindingValidation}；输入/输出摘要：${report.inputSummary && report.outputSummary ? "已绑定" : "缺失"}`,
    `数据库完整性：${report.databaseIntegrity}；资产校验：${report.assetValidation}；重开校验：${report.reopenValidation}`,
    `业务引用对账：${report.businessReferenceValidation}；输入引用 ${report.businessReferenceReconciliation.sourceReferenceCount}，输出引用 ${report.businessReferenceReconciliation.outputReferenceCount}`,
    `警告审核：${report.warningsApproved ? "已批准" : "未批准"}`
  ];
  if (report.failureCodes.length > 0) lines.push(`阻断原因：${report.failureCodes.join(", ")}`);
  if (report.warningCodes.length > 0) lines.push(`待人工确认警告：${report.warningCodes.join(", ")}`);
  lines.push("报告不包含项目正文、图片字节、凭证、Cookie 或 token。");
  return `${lines.join("\n")}\n`;
}

function releaseBindingFailure(input: {
  readonly sourceBackupId?: string;
  readonly sourceBackupDigest?: string;
  readonly toolCommit?: string;
  readonly candidateImageDigest?: string;
  readonly inputSummary: DataSummary | null;
  readonly outputSummary: DataSummary | null;
}): FailureCode | undefined {
  const complete = Boolean(
    input.sourceBackupId?.trim() &&
    isSha256(input.sourceBackupDigest) &&
    isCommit(input.toolCommit) &&
    isImageDigest(input.candidateImageDigest) &&
    input.inputSummary &&
    input.outputSummary
  );
  if (!complete) return "report_binding_missing";
  if (!sourceBackupDigestMatches(input.sourceBackupDigest, input.inputSummary)) return "source_backup_digest_mismatch";
  return undefined;
}

export function sourceBackupDigestMatches(sourceBackupDigest: string | undefined, inputSummary: DataSummary | null): boolean {
  const normalizedDigest = normalizedSha256(sourceBackupDigest);
  return inputSummary !== null && normalizedDigest !== undefined && normalizedDigest === inputSummary.directoryDigest;
}

export function hasBindingFacts(options: MigrationOptions): boolean {
  return Boolean(options.sourceBackupId?.trim() && options.sourceBackupDigest && options.toolCommit && options.candidateImageDigest);
}

function isSha256(value: string | undefined): boolean {
  return normalizedSha256(value) !== undefined;
}

function normalizedSha256(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase().replace(/^sha256:/u, "");
  return /^[0-9a-f]{64}$/u.test(normalized) ? normalized : undefined;
}

function isCommit(value: string | undefined): boolean {
  return value !== undefined && /^[0-9a-f]{40}$/iu.test(value);
}

function isImageDigest(value: string | undefined): boolean {
  return value !== undefined && /^sha256:[0-9a-f]{64}$/iu.test(value);
}

function toReportProject(project: ProjectResult): ReportProjectResult {
  return {
    projectHash: hash(project.id),
    userHash: hash(project.userId),
    status: project.status,
    sourceShapeCount: project.sourceShapeCount,
    targetElementCount: project.targetElementCount,
    assetReferences: project.assetReferences,
    warnings: project.warnings,
    failures: project.status === "blocked" ? project.failures : []
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  MIGRATION_TOOL_VERSION,
  type FailureCode,
  type BusinessReferenceReconciliation,
  type MigrationCounts,
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
  const status = input.failureCodes.length === 0 && (input.warningCodes.length === 0 || input.warningsApproved) ? "ready" : "blocked";
  return {
    status,
    toolVersion: MIGRATION_TOOL_VERSION,
    sourceBackupIdHash: input.sourceBackupId ? hash(input.sourceBackupId) : null,
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
    failureCodes: unique(input.failureCodes),
    warningCodes: unique(input.warningCodes),
    warningsApproved: input.warningsApproved,
    reportFiles: {
      machine: join(input.reportDir, "migration-report.json"),
      human: join(input.reportDir, "migration-summary.txt")
    }
  };
}

export function writeMigrationReport(report: MigrationReport): void {
  const reportDir = dirname(report.reportFiles.machine);
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(report.reportFiles.machine, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(report.reportFiles.human, humanSummary(report), "utf8");
}

function humanSummary(report: MigrationReport): string {
  const status = report.status === "ready" ? "READY" : "BLOCKED";
  const lines = [
    `AI Cove Excalidraw 离线迁移：${status}`,
    `工具版本：${report.toolVersion}`,
    `项目：输入 ${report.counts.inputProjects}，成功 ${report.counts.convertedProjects}，失败 ${report.counts.failedProjects}`,
    `元素：输入 ${report.counts.inputShapes}，输出 ${report.counts.outputElements}`,
    `资产引用：${report.counts.assetReferences}，已校验资产：${report.counts.validatedAssets}`,
    `数据库完整性：${report.databaseIntegrity}；资产校验：${report.assetValidation}；重开校验：${report.reopenValidation}`,
    `业务引用对账：${report.businessReferenceValidation}；输入引用 ${report.businessReferenceReconciliation.sourceReferenceCount}，输出引用 ${report.businessReferenceReconciliation.outputReferenceCount}`,
    `警告审核：${report.warningsApproved ? "已批准" : "未批准"}`
  ];
  if (report.failureCodes.length > 0) lines.push(`阻断原因：${report.failureCodes.join(", ")}`);
  if (report.warningCodes.length > 0) lines.push(`待人工确认警告：${report.warningCodes.join(", ")}`);
  lines.push("报告不包含项目正文、图片字节、凭证、Cookie 或 token。");
  return `${lines.join("\n")}\n`;
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

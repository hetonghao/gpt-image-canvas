import { emptyBusinessReferenceReconciliation, emptyCounts } from "./migration-support.js";
import type { MigrationPaths } from "./offline-paths.js";
import type {
  BusinessReferenceReconciliation,
  CheckState,
  DataSummary,
  FailureCode,
  MigrationCounts,
  MigrationOptions,
  ProjectResult,
  TableReconciliation,
  WarningCode
} from "./types.js";

export type MigrationReportInput = {
  readonly paths: MigrationPaths;
  readonly options: MigrationOptions;
  readonly inputSummary: DataSummary | null;
  readonly outputSummary: DataSummary | null;
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

export function blockedReportInput(
  paths: MigrationPaths,
  options: MigrationOptions,
  failureCode: FailureCode,
  inputSummary: DataSummary | null = null,
  outputSummary: DataSummary | null = null
): MigrationReportInput {
  return {
    paths,
    options,
    inputSummary,
    outputSummary,
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

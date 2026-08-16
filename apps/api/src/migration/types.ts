export const MIGRATION_TOOL_VERSION = "ai-cove-excalidraw-migration/1" as const;

export type FailureCode =
  | "asset_materialization_failed"
  | "asset_missing"
  | "binding_or_parent_loss"
  | "business_reference_reconciliation_failed"
  | "copy_failed"
  | "database_reconciliation_failed"
  | "geometry_invalid"
  | "input_invalid"
  | "invalid_snapshot"
  | "output_protected"
  | "reopen_mismatch"
  | "report_binding_missing"
  | "report_protected"
  | "snapshot_too_large"
  | "source_backup_digest_mismatch"
  | "source_integrity_failed"
  | "unknown_shape"
  | "unsupported_page_model"
  | "warning_unapproved";

export type WarningCode = "duplicate_asset_reference" | "orphan_asset_record" | "session_state_reset" | "visual_degraded";
export type CheckState = "ok" | "failed" | "skipped";
export type BusinessReferenceIssueCode = "asset_user_mismatch" | "invalid_json" | "invalid_reference" | "missing_asset" | "missing_generation" | "missing_output";

export type MigrationOptions = {
  readonly inputDir: string;
  readonly outputDir: string;
  readonly reportDir?: string;
  readonly sourceBackupId?: string;
  readonly sourceBackupDigest?: string;
  readonly toolCommit?: string;
  readonly candidateImageDigest?: string;
  readonly approveWarnings?: boolean;
};

export type ProjectRow = {
  readonly id: string;
  readonly userId: string;
  readonly snapshotJson: string;
};

export type AssetRow = {
  readonly id: string;
  readonly userId: string;
  readonly fileName: string;
  readonly relativePath: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number | null;
  readonly contentSha256: string | null;
};

export type VerifiedAsset = AssetRow & {
  readonly actualByteSize: number;
  readonly actualContentSha256: string;
  readonly actualWidth: number;
  readonly actualHeight: number;
  readonly sourceBytes?: Uint8Array;
};

export type AssetVerificationOutcome =
  | { readonly kind: "verified"; readonly value: VerifiedAsset }
  | { readonly kind: "blocked"; readonly code: "asset_missing" | "asset_materialization_failed" };

export type ConvertedProject = {
  readonly id: string;
  readonly userId: string;
  readonly snapshotJson: string;
  readonly sourceShapeCount: number;
  readonly targetElementCount: number;
  readonly assetReferences: number;
  readonly verifiedAssets: readonly VerifiedAsset[];
  readonly warnings: readonly WarningCode[];
};

export type BlockedProject = {
  readonly id: string;
  readonly userId: string;
  readonly sourceShapeCount: number;
  readonly targetElementCount: 0;
  readonly assetReferences: 0;
  readonly verifiedAssets: readonly [];
  readonly warnings: readonly WarningCode[];
  readonly failures: readonly FailureCode[];
};

export type ProjectResult =
  | (ConvertedProject & { readonly status: "converted" })
  | (BlockedProject & { readonly status: "blocked" });

export type TableFingerprint = {
  readonly name: string;
  readonly rowCount: number;
  readonly primaryKeyDigest: string | null;
};

export type TableReconciliation = TableFingerprint & {
  readonly outputRowCount: number;
  readonly outputPrimaryKeyDigest: string | null;
};

export type BusinessReferenceReconciliation = {
  readonly sourceReferenceCount: number;
  readonly outputReferenceCount: number;
  readonly sourceIssueCount: number;
  readonly outputIssueCount: number;
  readonly sourceIssueCodes: readonly BusinessReferenceIssueCode[];
  readonly outputIssueCodes: readonly BusinessReferenceIssueCode[];
  readonly sourceDigest: string;
  readonly outputDigest: string;
};

export type DataSummary = {
  readonly directoryDigest: string;
  readonly databaseDigest: string;
  readonly assetDigest: string;
  readonly fileCount: number;
  readonly byteCount: number;
  readonly projectCount: number;
  readonly assetCount: number;
};

export type MigrationCounts = {
  readonly inputProjects: number;
  readonly convertedProjects: number;
  readonly failedProjects: number;
  readonly warningProjects: number;
  readonly inputShapes: number;
  readonly outputElements: number;
  readonly assetReferences: number;
  readonly validatedAssets: number;
  readonly nonSceneTables: number;
};

export type MigrationReport = {
  readonly status: "ready" | "blocked";
  readonly toolVersion: string;
  readonly sourceBackupIdHash: string | null;
  readonly sourceBackupDigest: string | null;
  readonly toolCommit: string | null;
  readonly candidateImageDigest: string | null;
  readonly inputSummary: DataSummary | null;
  readonly outputSummary: DataSummary | null;
  readonly reportBindingValidation: CheckState;
  readonly inputLabel: string;
  readonly outputLabel: string;
  readonly counts: MigrationCounts;
  readonly databaseIntegrity: CheckState;
  readonly assetValidation: CheckState;
  readonly reopenValidation: CheckState;
  readonly businessReferenceValidation: CheckState;
  readonly businessReferenceReconciliation: BusinessReferenceReconciliation;
  readonly tableReconciliation: readonly TableReconciliation[];
  readonly projectResults: readonly ReportProjectResult[];
  readonly failureCodes: readonly FailureCode[];
  readonly warningCodes: readonly WarningCode[];
  readonly warningsApproved: boolean;
  readonly reportFiles: { readonly machine: string; readonly human: string };
};

export type ReportProjectResult = {
  readonly projectHash: string;
  readonly userHash: string;
  readonly status: "converted" | "blocked";
  readonly sourceShapeCount: number;
  readonly targetElementCount: number;
  readonly assetReferences: number;
  readonly warnings: readonly WarningCode[];
  readonly failures: readonly FailureCode[];
};

export type ConversionOutcome =
  | { readonly kind: "converted"; readonly value: ConvertedProject }
  | { readonly kind: "blocked"; readonly value: BlockedProject };

export type JsonRecord = Record<string, unknown>;

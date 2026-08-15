import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  PRIVATE_PROMPT,
  PRIVATE_TOKEN,
  seedMigrationFixture,
  tinyPngBytes,
  type MigrationFixtureKind
} from "../migration/fixtures.js";
import { runOfflineMigration } from "../migration/offline-migration.js";
import { summarizeDataDir } from "../migration/summary.js";

const TEST_BINDING = {
  sourceBackupId: "fixture-backup-issue-69",
  toolCommit: "b".repeat(40),
  candidateImageDigest: `sha256:${"c".repeat(64)}`
} as const;

function bindingFor(inputDir: string) {
  return { ...TEST_BINDING, sourceBackupDigest: summarizeDataDir(inputDir).directoryDigest };
}

test("offline migration creates a fresh Excalidraw database and preserves duplicate asset references", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-success-"));
  try {
    const fixture = seedMigrationFixture(root, "success");
    const outputDir = join(root, "output");
    const reportDir = join(root, "report");
    const binding = bindingFor(fixture.inputDir);
    const result = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir, reportDir, ...binding });

    assert.equal(result.status, "ready");
    assert.equal(result.counts.inputProjects, 1);
    assert.equal(result.counts.convertedProjects, 1);
    assert.equal(result.counts.failedProjects, 0);
    assert.equal(result.counts.assetReferences, 1);
    assert.equal(result.businessReferenceValidation, "ok");
    assert.equal(result.businessReferenceReconciliation.sourceReferenceCount, 9);
    assert.equal(result.businessReferenceReconciliation.sourceDigest, result.businessReferenceReconciliation.outputDigest);
    assert.equal(result.reportBindingValidation, "ok");
    assert.equal(result.sourceBackupDigest, binding.sourceBackupDigest);
    assert.equal(result.toolCommit, binding.toolCommit);
    assert.equal(result.candidateImageDigest, binding.candidateImageDigest);
    if (!result.inputSummary || !result.outputSummary) throw new Error("expected report data summaries");
    assert.equal(result.inputSummary.projectCount, 1);
    assert.equal(result.outputSummary.projectCount, 1);
    assert.notEqual(outputDir, fixture.inputDir);
    assert.equal(readSourceSnapshot(fixture.inputDir, fixture.projectId), fixture.sourceSnapshotJson);

    const sqlite = new Database(join(outputDir, "gpt-image-canvas.sqlite"), { readonly: true });
    try {
      const row = sqlite.prepare("SELECT snapshot_json FROM projects WHERE id = ?").get(fixture.projectId);
      assert.ok(isRecord(row));
      const snapshot = JSON.parse(readString(row.snapshot_json));
      assert.equal(snapshot.format, "ai-cove-excalidraw");
      assert.equal(snapshot.version, 1);
      assert.equal(snapshot.scene.elements.length, 3);
      assert.equal(Object.keys(snapshot.assets).length, 1);
    } finally {
      sqlite.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy assets schema derives integrity metadata in the fresh output", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-legacy-schema-"));
  try {
    const fixture = seedMigrationFixture(root, "legacy-schema");
    const inputDatabase = new Database(join(fixture.inputDir, "gpt-image-canvas.sqlite"), { readonly: true });
    try {
      const columns = inputDatabase.prepare("PRAGMA table_info(assets)").all();
      assert.equal(columns.some((column) => isRecord(column) && column.name === "byte_size"), false);
      assert.equal(columns.some((column) => isRecord(column) && column.name === "content_sha256"), false);
    } finally {
      inputDatabase.close();
    }

    const outputDir = join(root, "output");
    const result = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir, reportDir: join(root, "report"), ...bindingFor(fixture.inputDir) });
    assert.equal(result.status, "ready");
    const outputDatabase = new Database(join(outputDir, "gpt-image-canvas.sqlite"), { readonly: true });
    try {
      const row = outputDatabase.prepare("SELECT byte_size, content_sha256 FROM assets").get();
      assert.ok(isRecord(row));
      assert.equal(row.byte_size, tinyPngBytes.byteLength);
      assert.equal(row.content_sha256, createHash("sha256").update(tinyPngBytes).digest("hex"));
    } finally {
      outputDatabase.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const kind of ["unknown-shape", "missing-asset", "corrupt-asset", "multi-page"] as const) {
  test(`offline migration blocks ${kind} without changing the source`, async () => {
    const root = mkdtempSync(join(tmpdir(), `gpt-image-canvas-migration-${kind}-`));
    try {
      const fixture = seedMigrationFixture(root, kind);
      const before = readSourceSnapshot(fixture.inputDir, fixture.projectId);
      const result = await runOfflineMigration({
        inputDir: fixture.inputDir,
        outputDir: join(root, "output"),
        reportDir: join(root, "report"),
        ...bindingFor(fixture.inputDir)
      });

      assert.equal(result.status, "blocked");
      assert.ok(result.counts.failedProjects >= 1);
      assert.equal(readSourceSnapshot(fixture.inputDir, fixture.projectId), before);
      assert.ok(result.projectResults.some((project) => project.status === "blocked"));
      assert.equal(existsSync(join(root, "output")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("migration requires explicit approval for visible degradations", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-warning-"));
  try {
    const fixture = seedMigrationFixture(root, "degraded-shape");
    const blocked = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir: join(root, "output-blocked"), reportDir: join(root, "report-blocked"), ...bindingFor(fixture.inputDir) });
    assert.equal(blocked.status, "blocked");
    assert.ok(blocked.failureCodes.includes("warning_unapproved"));
    assert.ok(blocked.warningCodes.includes("visual_degraded"));
    const approved = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir: join(root, "output-approved"), reportDir: join(root, "report-approved"), approveWarnings: true, ...bindingFor(fixture.inputDir) });
    assert.equal(approved.status, "ready");
    assert.equal(approved.warningsApproved, true);
    assert.ok(approved.warningCodes.includes("visual_degraded"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration blocks dangling generation and Agent asset references", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-dangling-reference-"));
  try {
    const fixture = seedMigrationFixture(root, "dangling-reference");
    const before = readSourceSnapshot(fixture.inputDir, fixture.projectId);
    const result = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir: join(root, "output"), reportDir: join(root, "report"), ...bindingFor(fixture.inputDir) });
    assert.equal(result.status, "blocked");
    assert.ok(result.failureCodes.includes("business_reference_reconciliation_failed"));
    assert.equal(result.businessReferenceValidation, "failed");
    assert.ok(result.businessReferenceReconciliation.sourceIssueCount > 0);
    assert.ok(result.businessReferenceReconciliation.sourceIssueCodes.includes("missing_asset"));
    assert.ok(result.businessReferenceReconciliation.sourceIssueCodes.includes("missing_output"));
    assert.equal(readSourceSnapshot(fixture.inputDir, fixture.projectId), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("offline migration protects an existing output directory on rerun", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-rerun-"));
  try {
    const fixture = seedMigrationFixture(root, "success");
    const outputDir = join(root, "output");
    const first = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir, reportDir: join(root, "report-1"), ...bindingFor(fixture.inputDir) });
    assert.equal(first.status, "ready");
    const outputBefore = readFileSync(join(outputDir, "gpt-image-canvas.sqlite"));
    const second = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir, reportDir: join(root, "report-2"), ...bindingFor(fixture.inputDir) });
    assert.equal(second.status, "blocked");
    assert.ok(second.failureCodes.includes("output_protected"));
    assert.deepEqual(readFileSync(join(outputDir, "gpt-image-canvas.sqlite")), outputBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration reports redact user content and token-like values", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-privacy-"));
  try {
    const fixture = seedMigrationFixture(root, "success");
    const reportDir = join(root, "report");
    await runOfflineMigration({ inputDir: fixture.inputDir, outputDir: join(root, "output"), reportDir, ...bindingFor(fixture.inputDir) });
    const report = readFileSync(join(reportDir, "migration-report.json"), "utf8");
    const summary = readFileSync(join(reportDir, "migration-summary.txt"), "utf8");
    assert.equal(report.includes(PRIVATE_PROMPT), false);
    assert.equal(report.includes(PRIVATE_TOKEN), false);
    assert.equal(summary.includes(PRIVATE_PROMPT), false);
    assert.equal(summary.includes(PRIVATE_TOKEN), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function readSourceSnapshot(inputDir: string, projectId: string): string {
  const sqlite = new Database(join(inputDir, "gpt-image-canvas.sqlite"), { readonly: true });
  try {
    const row = sqlite.prepare("SELECT snapshot_json FROM projects WHERE id = ?").get(projectId);
    return readString(isRecord(row) ? row.snapshot_json : undefined);
  } finally {
    sqlite.close();
  }
}

function readString(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected a string");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

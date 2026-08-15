import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { assetIdFromRow, seedDuplicateAssetFixture } from "../migration/duplicate-assets-fixture.js";
import { seedMigrationFixture } from "../migration/fixtures.js";
import { runOfflineMigration } from "../migration/offline-migration.js";
import { openReadonlyDatabase, readAssets, readProjects, tableFingerprints } from "../migration/sqlite.js";
import { summarizeDataDir } from "../migration/summary.js";
import { validateOutput } from "../migration/validation.js";
import type { ProjectResult } from "../migration/types.js";

const TEST_BINDING = {
  sourceBackupId: "fixture-backup-issue-69",
  toolCommit: "b".repeat(40),
  candidateImageDigest: `sha256:${"c".repeat(64)}`
} as const;

function bindingFor(inputDir: string) {
  return { ...TEST_BINDING, sourceBackupDigest: summarizeDataDir(inputDir).directoryDigest };
}

test("migration keeps same-user duplicate bytes openable under the candidate asset index", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-duplicate-content-"));
  try {
    const fixture = seedDuplicateAssetFixture(root);
    const outputDir = join(root, "output");
    const result = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir, reportDir: join(root, "report"), ...bindingFor(fixture.inputDir) });

    assert.equal(result.status, "ready");
    assert.equal(result.businessReferenceValidation, "ok");
    assert.equal(result.businessReferenceReconciliation.sourceDigest, result.businessReferenceReconciliation.outputDigest);
    const database = new Database(join(outputDir, "gpt-image-canvas.sqlite"));
    try {
      database.exec("CREATE UNIQUE INDEX IF NOT EXISTS assets_user_content_sha256_idx ON assets(user_id, content_sha256)");
      const assetRows = database.prepare("SELECT id, content_sha256 FROM assets WHERE user_id = ? ORDER BY id").all("user-1");
      assert.equal(assetRows.length, 1);
      assert.deepEqual(assetRows.map(assetIdFromRow), ["asset-success"]);
      assert.deepEqual(readFileSync(join(outputDir, "assets/asset-success.png")), readFileSync(join(fixture.inputDir, "assets/asset-success.png")));
      const projectRow = database.prepare("SELECT snapshot_json FROM projects WHERE id = ?").get(fixture.projectId);
      assert.ok(isRecord(projectRow));
      const snapshot = JSON.parse(readString(projectRow.snapshot_json));
      const assets = isRecord(snapshot) && isRecord(snapshot.assets) ? Object.values(snapshot.assets) : [];
      assert.deepEqual(assets.flatMap((asset) => isRecord(asset) && typeof asset.assetId === "string" ? [asset.assetId] : []).sort(), ["asset-success", "asset-success"]);
      const generation = database.prepare("SELECT reference_asset_id FROM generation_records WHERE id = ?").get("generation-1");
      assert.ok(isRecord(generation));
      assert.equal(generation.reference_asset_id, "asset-success");
      const output = database.prepare("SELECT asset_id FROM generation_outputs WHERE id = ?").get("output-1");
      assert.ok(isRecord(output));
      assert.equal(output.asset_id, "asset-success");
      const generationReference = database.prepare("SELECT asset_id FROM generation_reference_assets WHERE generation_id = ?").get("generation-1");
      assert.ok(isRecord(generationReference));
      assert.equal(generationReference.asset_id, "asset-success");
      const conversation = database.prepare("SELECT messages_json, context_json FROM agent_conversations WHERE id = ?").get("conversation-1");
      assert.ok(isRecord(conversation));
      assert.equal(readString(conversation.messages_json).includes("asset-success-duplicate"), false);
      assert.equal(readString(conversation.messages_json).includes("/api/assets/asset-success"), true);
      assert.equal(readString(conversation.context_json).includes("asset-success-duplicate"), false);
      const link = database.prepare("SELECT asset_id, asset_url, asset_ids_json FROM asset_links WHERE id = ?").get("link-1");
      assert.ok(isRecord(link));
      assert.equal(link.asset_id, "asset-success");
      assert.equal(link.asset_url, "/api/assets/asset-success");
      assert.equal(link.asset_ids_json, JSON.stringify(["asset-success"]));
    } finally {
      database.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration preserves an existing report destination on blocked admission", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-report-protection-"));
  try {
    const fixture = seedMigrationFixture(root, "success");
    const reportDir = join(root, "report");
    mkdirSync(reportDir);
    writeFileSync(join(reportDir, "migration-report.json"), "existing-machine-evidence\n");
    writeFileSync(join(reportDir, "migration-summary.txt"), "existing-human-evidence\n");

    const result = await runOfflineMigration({
      inputDir: fixture.inputDir,
      outputDir: join(root, "output"),
      reportDir,
      ...bindingFor(fixture.inputDir)
    });

    assert.equal(result.status, "blocked");
    assert.ok(result.failureCodes.includes("report_protected"));
    assert.equal(readFileSync(join(reportDir, "migration-report.json"), "utf8"), "existing-machine-evidence\n");
    assert.equal(readFileSync(join(reportDir, "migration-summary.txt"), "utf8"), "existing-human-evidence\n");
    assert.equal(existsSync(join(root, "output")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration preserves report evidence when a rerun reuses its destination", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-report-rerun-"));
  try {
    const fixture = seedMigrationFixture(root, "success");
    const outputDir = join(root, "output");
    const reportDir = join(root, "report");
    const first = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir, reportDir, ...bindingFor(fixture.inputDir) });
    assert.equal(first.status, "ready");
    const machineBefore = readFileSync(join(reportDir, "migration-report.json"));
    const humanBefore = readFileSync(join(reportDir, "migration-summary.txt"));
    const second = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir, reportDir, ...bindingFor(fixture.inputDir) });

    assert.equal(second.status, "blocked");
    assert.ok(second.failureCodes.includes("report_protected"));
    assert.deepEqual(readFileSync(join(reportDir, "migration-report.json")), machineBefore);
    assert.deepEqual(readFileSync(join(reportDir, "migration-summary.txt")), humanBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration blocks ready status when release binding facts are missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-missing-binding-"));
  try {
    const fixture = seedMigrationFixture(root, "success");
    const result = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir: join(root, "output"), reportDir: join(root, "report") });

    assert.equal(result.status, "blocked");
    assert.equal(result.reportBindingValidation, "failed");
    assert.ok(result.failureCodes.includes("report_binding_missing"));
    assert.equal(result.sourceBackupIdHash, null);
    assert.equal(result.outputSummary, null);
    assert.equal(existsSync(join(root, "output")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration blocks a release binding whose source digest does not match the immutable input", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-wrong-source-digest-"));
  try {
    const fixture = seedMigrationFixture(root, "success");
    const binding = bindingFor(fixture.inputDir);
    const result = await runOfflineMigration({
      inputDir: fixture.inputDir,
      outputDir: join(root, "output"),
      reportDir: join(root, "report"),
      ...binding,
      sourceBackupDigest: "d".repeat(64)
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.reportBindingValidation, "failed");
    assert.ok(result.failureCodes.includes("source_backup_digest_mismatch"));
    assert.equal(result.inputSummary?.directoryDigest, binding.sourceBackupDigest);
    assert.equal(result.outputSummary, null);
    assert.equal(existsSync(join(root, "output")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("migration blocks target reopen when a valid asset cannot restore the target scene", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-reopen-failure-"));
  try {
    const fixture = seedMigrationFixture(root, "success");
    const outputDir = join(root, "output");
    const result = await runOfflineMigration({ inputDir: fixture.inputDir, outputDir, reportDir: join(root, "report"), ...bindingFor(fixture.inputDir) });
    assert.equal(result.status, "ready");

    const outputDatabase = new Database(join(outputDir, "gpt-image-canvas.sqlite"));
    try {
      const row = outputDatabase.prepare("SELECT snapshot_json FROM projects WHERE id = ?").get(fixture.projectId);
      if (!isRecord(row)) throw new Error("expected output project");
      const snapshot: unknown = JSON.parse(readString(row.snapshot_json));
      const scene = isRecord(snapshot) ? snapshot.scene : undefined;
      const elements = isRecord(scene) ? scene.elements : undefined;
      const image = Array.isArray(elements) ? elements.find((element) => isRecord(element) && element.type === "image") : undefined;
      if (!isRecord(image)) throw new Error("expected output image");
      image.width = 0;
      outputDatabase.prepare("UPDATE projects SET snapshot_json = ? WHERE id = ?").run(JSON.stringify(snapshot), fixture.projectId);
    } finally {
      outputDatabase.close();
    }

    const sourceDatabase = openReadonlyDatabase(fixture.inputDir);
    const outputReadDatabase = openReadonlyDatabase(outputDir);
    try {
      const outputProjects = readProjects(outputReadDatabase);
      const outputAssets = readAssets(outputReadDatabase);
      const verifiedAssets = outputAssets.flatMap((asset) => asset.byteSize !== null && asset.contentSha256 !== null ? [{
        ...asset,
        actualByteSize: asset.byteSize,
        actualContentSha256: asset.contentSha256,
        actualWidth: asset.width,
        actualHeight: asset.height
      }] : []);
      const projects: readonly ProjectResult[] = outputProjects.map((project) => ({
        ...project,
        status: "converted",
        sourceShapeCount: 3,
        targetElementCount: 3,
        assetReferences: 1,
        verifiedAssets,
        warnings: []
      }));
      const validation = await validateOutput({ inputDir: fixture.inputDir, outputDir, sourceTables: tableFingerprints(sourceDatabase), projects });
      assert.equal(validation.assetValidation, "ok");
      assert.equal(validation.reopenValidation, "failed");
      assert.ok(validation.failures.includes("reopen_mismatch"));
    } finally {
      sourceDatabase.close();
      outputReadDatabase.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function readString(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected a string");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

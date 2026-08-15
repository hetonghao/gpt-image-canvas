import { existsSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
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

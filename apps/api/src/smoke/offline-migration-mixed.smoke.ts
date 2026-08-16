import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { embeddedPngBytes, seedMixedInputFixture } from "../migration/mixed-input-fixture.js";
import { runOfflineMigration } from "../migration/offline-migration.js";
import { summarizeDataDir } from "../migration/summary.js";

test("migration preserves target scenes and materializes valid embedded legacy assets in a mixed input", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-mixed-"));
  try {
    const fixture = seedMixedInputFixture(root);
    const outputDir = join(root, "output");
    const result = await runOfflineMigration({
      inputDir: fixture.inputDir,
      outputDir,
      reportDir: join(root, "report"),
      sourceBackupId: "fixture-mixed-input",
      sourceBackupDigest: summarizeDataDir(fixture.inputDir).directoryDigest,
      toolCommit: "b".repeat(40),
      candidateImageDigest: `sha256:${"c".repeat(64)}`
    });

    assert.equal(result.status, "ready", JSON.stringify({ failures: result.failureCodes, references: result.businessReferenceReconciliation, projects: result.projectResults }));
    assert.equal(result.counts.inputProjects, 2);
    assert.equal(result.counts.convertedProjects, 2);
    assert.equal(result.counts.failedProjects, 0);
    assert.equal(result.assetValidation, "ok");
    assert.equal(result.reopenValidation, "ok");
    assert.equal(result.businessReferenceValidation, "ok");

    const source = new Database(join(fixture.inputDir, "gpt-image-canvas.sqlite"), { readonly: true });
    const output = new Database(join(outputDir, "gpt-image-canvas.sqlite"), { readonly: true });
    try {
      assert.equal(readProjectSnapshot(source, fixture.targetProjectId), fixture.targetSnapshotJson);
      assert.equal(readProjectSnapshot(output, fixture.targetProjectId), fixture.targetSnapshotJson);
      assert.equal(source.prepare("SELECT COUNT(*) AS count FROM assets WHERE id = ?").pluck().get(fixture.embeddedAssetId), 0);

      const asset = output.prepare("SELECT relative_path, byte_size, content_sha256 FROM assets WHERE id = ?").get(fixture.embeddedAssetId);
      assert.ok(isRecord(asset));
      const relativePath = readString(asset.relative_path);
      assert.equal(asset.byte_size, embeddedPngBytes.byteLength);
      assert.match(readString(asset.content_sha256), /^[a-f0-9]{64}$/u);
      assert.deepEqual(readFileSync(join(outputDir, relativePath)), embeddedPngBytes);

      const migrated: unknown = JSON.parse(readProjectSnapshot(output, fixture.embeddedProjectId));
      const assets = isRecord(migrated) && isRecord(migrated.assets) ? Object.values(migrated.assets) : [];
      assert.deepEqual(assets.flatMap((value) => isRecord(value) && typeof value.assetId === "string" ? [value.assetId] : []), [fixture.embeddedAssetId]);
    } finally {
      source.close();
      output.close();
    }
    assert.equal(existsSync(join(fixture.inputDir, "assets", `${fixture.embeddedAssetId}.png`)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function readProjectSnapshot(database: Database.Database, projectId: string): string {
  const row = database.prepare("SELECT snapshot_json FROM projects WHERE id = ?").get(projectId);
  if (!isRecord(row)) throw new Error("expected project row");
  return readString(row.snapshot_json);
}

function readString(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected string");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

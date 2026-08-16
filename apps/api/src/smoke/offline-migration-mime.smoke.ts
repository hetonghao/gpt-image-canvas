import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { seedMigrationFixture } from "../migration/fixtures.js";
import { runOfflineMigration } from "../migration/offline-migration.js";
import { summarizeDataDir } from "../migration/summary.js";

const TEST_BINDING = {
  sourceBackupId: "fixture-backup-issue-69",
  toolCommit: "b".repeat(40),
  candidateImageDigest: `sha256:${"c".repeat(64)}`
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("migration normalizes a legacy JPEG mislabeled as PNG", async () => {
  const root = mkdtempSync(join(tmpdir(), "gpt-image-canvas-migration-mislabelled-jpeg-"));
  try {
    const fixture = seedMigrationFixture(root, "mislabelled-jpeg");
    const result = await runOfflineMigration({
      inputDir: fixture.inputDir,
      outputDir: join(root, "output"),
      reportDir: join(root, "report"),
      sourceBackupDigest: summarizeDataDir(fixture.inputDir).directoryDigest,
      ...TEST_BINDING
    });
    assert.equal(result.status, "ready");
    const sqlite = new Database(join(root, "output", "gpt-image-canvas.sqlite"), { readonly: true });
    try {
      const row = sqlite.prepare("SELECT file_name, relative_path, mime_type FROM assets").get();
      assert.ok(isRecord(row));
      assert.equal(row.file_name, "asset-mislabelled-jpeg.jpg");
      assert.equal(row.relative_path, "assets/asset-mislabelled-jpeg.png");
      assert.equal(row.mime_type, "image/jpeg");
    } finally {
      sqlite.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

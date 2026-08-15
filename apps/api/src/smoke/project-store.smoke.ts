import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-project-store-"));
const LARGE_PROJECT_SNAPSHOT_BYTES = 5 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

try {
  const [{ saveProjectSnapshot, getProjectState }, { parseProjectPayload }, { createApp }, { db }, { projects }] = await Promise.all([
    import("../domain/project/project-store.js"),
    import("../server/http/validation.js"),
    import("../server/app.js"),
    import("../infrastructure/database.js"),
    import("../infrastructure/schema.js")
  ]);
  const app = createApp();

  const hostContext = {
    user: {
      id: "project-user",
      displayName: "Project User"
    }
  };

  test("project saves return a lightweight acknowledgement", () => {
    const snapshot = {
      format: "ai-cove-excalidraw",
      version: 1,
      scene: {
        elements: [{ id: "text-1", type: "text", text: "Saved Excalidraw scene" }],
        appState: {}
      },
      assets: {}
    };

    const result = saveProjectSnapshot({ snapshotJson: JSON.stringify(snapshot) }, hostContext);

    assert.equal(result.id, "project-user:default");
    assert.equal(typeof result.updatedAt, "string");
    assert.ok(!("snapshot" in result), "saveProjectSnapshot should not reload the full snapshot payload");
    assert.ok(!("history" in result), "saveProjectSnapshot should not reload generation history on autosave");

    const project = getProjectState(hostContext);
    assert.deepEqual(project.snapshot, snapshot);
  });

  test("project payloads above 5MB still save so large canvases remain usable", () => {
    const largePayload = parseProjectPayload({
      snapshot: {
        format: "ai-cove-excalidraw",
        version: 1,
        scene: {
          elements: [{ id: "text-1", type: "text", text: "x".repeat(LARGE_PROJECT_SNAPSHOT_BYTES + 1) }],
          appState: {}
        },
        assets: {}
      }
    });

    assert.equal(largePayload.ok, true);
  });

  test("GET /api/project rejects persisted legacy snapshots without rewriting the row", async () => {
    const legacySnapshotJson = JSON.stringify({ document: { store: { "page:1": { id: "page:1", typeName: "record" } } } });
    const validSnapshotJson = JSON.stringify({
      format: "ai-cove-excalidraw",
      version: 1,
      scene: { elements: [{ id: "text-1", type: "text", text: "restored" }], appState: {} },
      assets: {}
    });
    getProjectState();
    const projectId = "default";
    db.update(projects).set({ snapshotJson: legacySnapshotJson }).where(eq(projects.id, projectId)).run();

    try {
      const response = await app.fetch(new Request("http://127.0.0.1:8787/api/project"));
      assert.equal(response.status, 409);
      const body: unknown = await response.json();
      const errorCode = isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
      assert.equal(errorCode, "project_snapshot_invalid");
      assert.equal(db.select({ snapshotJson: projects.snapshotJson }).from(projects).where(eq(projects.id, projectId)).get()?.snapshotJson, legacySnapshotJson);
    } finally {
      db.update(projects).set({ snapshotJson: validSnapshotJson }).where(eq(projects.id, projectId)).run();
    }
  });

  test("GET /api/project rejects malformed persisted snapshots without rewriting the row", async () => {
    const malformedSnapshotJson = '{"format":"ai-cove-excalidraw"';
    const validSnapshotJson = JSON.stringify({
      format: "ai-cove-excalidraw",
      version: 1,
      scene: { elements: [{ id: "text-1", type: "text", text: "restored" }], appState: {} },
      assets: {}
    });
    getProjectState();
    const projectId = "default";
    db.update(projects).set({ snapshotJson: malformedSnapshotJson }).where(eq(projects.id, projectId)).run();

    try {
      const response = await app.fetch(new Request("http://127.0.0.1:8787/api/project"));
      assert.equal(response.status, 409);
      const body: unknown = await response.json();
      const errorCode = isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
      assert.equal(errorCode, "project_snapshot_invalid");
      assert.equal(db.select({ snapshotJson: projects.snapshotJson }).from(projects).where(eq(projects.id, projectId)).get()?.snapshotJson, malformedSnapshotJson);
    } finally {
      db.update(projects).set({ snapshotJson: validSnapshotJson }).where(eq(projects.id, projectId)).run();
    }
  });

  test("legacy project snapshots are rejected", () => {
    assert.throws(
      () =>
        saveProjectSnapshot(
          {
            snapshotJson: JSON.stringify({ document: { store: { "page:1": { id: "page:1", typeName: "record" } } } })
          },
          hostContext
        ),
      /AI Cove Excalidraw scene/
    );
  });

  console.log("project-store.smoke.ts passed");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

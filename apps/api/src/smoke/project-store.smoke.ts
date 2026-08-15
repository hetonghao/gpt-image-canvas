import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-project-store-"));
const LARGE_PROJECT_SNAPSHOT_BYTES = 5 * 1024 * 1024;

process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

try {
  const { saveProjectSnapshot, getProjectState } = await import("../domain/project/project-store.js");
  const { parseProjectPayload } = await import("../server/http/validation.js");

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

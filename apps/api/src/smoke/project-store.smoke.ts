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
      document: {
        store: {
          "page:1": {
            id: "page:1",
            typeName: "record"
          }
        }
      }
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
        note: "x".repeat(LARGE_PROJECT_SNAPSHOT_BYTES + 1)
      }
    });

    assert.equal(largePayload.ok, true);
  });

  test("project snapshots omit unreferenced asset records", () => {
    const snapshot = {
      document: {
        store: {
          "document:document": {
            id: "document:document",
            typeName: "document"
          },
          "page:page": {
            id: "page:page",
            typeName: "page"
          },
          "asset:visible": {
            id: "asset:visible",
            typeName: "asset",
            type: "image",
            props: {
              src: "/api/assets/visible",
              w: 1,
              h: 1
            }
          },
          "asset:orphan": {
            id: "asset:orphan",
            typeName: "asset",
            type: "image",
            props: {
              src: "data:image/png;base64,AAAA",
              w: 1,
              h: 1
            }
          },
          "shape:visible": {
            id: "shape:visible",
            typeName: "shape",
            type: "image",
            props: {
              assetId: "asset:visible",
              w: 1,
              h: 1
            }
          }
        }
      }
    };

    saveProjectSnapshot({ snapshotJson: JSON.stringify(snapshot) }, hostContext);

    const project = getProjectState(hostContext);
    const store = (project.snapshot as typeof snapshot).document.store;
    assert.ok(store["asset:visible"], "referenced assets should be preserved");
    assert.ok(!("asset:orphan" in store), "unreferenced assets should be removed from project snapshots");
  });

  console.log("project-store.smoke.ts passed");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

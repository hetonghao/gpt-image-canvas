import { loadFromBlob } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import type {
  CanvasAssetReference,
  ExcalidrawProjectSnapshot
} from "@gpt-image-canvas/shared";
import type { CanvasAsset, CanvasAssetId } from "./canvas-editor";
import {
  agentPlanTombstonesForSnapshot,
  agentPlanTombstonesFromAppState
} from "./agent-plan-canvas";
import { hydrateSnapshotAssets } from "./excalidraw-asset-io";
import { deduplicateAgentPlanNodes } from "./excalidraw-shapes";

export interface HydratedScene {
  elements: readonly ExcalidrawElement[];
  appState: Record<string, unknown>;
  files: BinaryFiles;
  assets: Map<CanvasAssetId, CanvasAsset>;
  references: Map<FileId, CanvasAssetReference>;
  unavailableAssetIds: Set<string>;
}

export async function hydrateProjectSnapshot(
  snapshot: ExcalidrawProjectSnapshot | null,
  signal: AbortSignal
): Promise<HydratedScene> {
  if (!snapshot) {
    return {
      elements: [],
      appState: {},
      files: {},
      assets: new Map(),
      references: new Map(),
      unavailableAssetIds: new Set()
    };
  }

  const hydratedAssets = await hydrateSnapshotAssets(snapshot.assets, signal);
  const restored = await loadFromBlob(
    new Blob([
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "ai-cove-design",
        elements: snapshot.scene.elements,
        appState: snapshot.scene.appState,
        files: {}
      })
    ], { type: "application/json" }),
    null,
    null
  );
  return {
    ...hydratedAssets,
    elements: deduplicateAgentPlanNodes(restored.elements).map((element) => {
      if (element.type !== "image" || !element.fileId) return element;
      const reference = hydratedAssets.references.get(element.fileId);
      return reference && hydratedAssets.unavailableAssetIds.has(reference.assetId)
        ? { ...element, status: "error" as const }
        : element;
    }),
    appState: {
      ...restored.appState,
      aiCoveRemovedAgentPlanIds: agentPlanTombstonesForSnapshot(
        agentPlanTombstonesFromAppState(snapshot.scene.appState)
      )
    }
  };
}

export function createProjectSnapshot(
  elements: readonly ExcalidrawElement[],
  appState: AppState,
  assets: Record<string, CanvasAssetReference>,
  removedAgentPlanIds: ReadonlySet<string>
): ExcalidrawProjectSnapshot {
  return {
    format: "ai-cove-excalidraw",
    version: 1,
    scene: {
      elements: elements.filter((element) => !element.isDeleted).map((element) => ({ ...element })),
      appState: {
        theme: appState.theme,
        viewBackgroundColor: appState.viewBackgroundColor,
        gridSize: appState.gridSize,
        aiCoveRemovedAgentPlanIds: agentPlanTombstonesForSnapshot(removedAgentPlanIds)
      }
    },
    assets
  };
}

import type { GenerationRecord } from "./generation.js";

export const EXCALIDRAW_PROJECT_FORMAT = "ai-cove-excalidraw" as const;
export const EXCALIDRAW_PROJECT_VERSION = 1 as const;

export interface CanvasAssetReference {
  assetId: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  contentSha256: string;
}

export interface ExcalidrawProjectSnapshot {
  format: typeof EXCALIDRAW_PROJECT_FORMAT;
  version: typeof EXCALIDRAW_PROJECT_VERSION;
  scene: {
    elements: Array<Record<string, unknown>>;
    appState: Record<string, unknown>;
  };
  assets: Record<string, CanvasAssetReference>;
}

export interface ProjectState {
  id: string;
  name: string;
  snapshot: unknown | null;
  history: GenerationRecord[];
  updatedAt: string;
}

export type ExcalidrawProjectSnapshotValidation =
  | { ok: true; value: ExcalidrawProjectSnapshot | null }
  | { ok: false; reason: string };

export function validateExcalidrawProjectSnapshot(value: unknown): ExcalidrawProjectSnapshotValidation {
  if (value === null) {
    return { ok: true, value: null };
  }
  if (!isRecord(value) || value.format !== EXCALIDRAW_PROJECT_FORMAT || value.version !== EXCALIDRAW_PROJECT_VERSION) {
    return { ok: false, reason: "Project snapshot is not an AI Cove Excalidraw scene." };
  }
  if (Object.hasOwn(value, "files") || !isRecord(value.scene) || Object.hasOwn(value.scene, "files")) {
    return { ok: false, reason: "Project snapshots must not embed Excalidraw files." };
  }
  if (!Array.isArray(value.scene.elements) || !isRecord(value.scene.appState) || !isRecord(value.assets)) {
    return { ok: false, reason: "Project scene or asset references are invalid." };
  }

  const assetReferences: Record<string, CanvasAssetReference> = {};
  for (const [fileId, reference] of Object.entries(value.assets)) {
    if (!fileId || !isCanvasAssetReference(reference)) {
      return { ok: false, reason: "Project asset reference metadata is invalid." };
    }
    assetReferences[fileId] = reference;
  }

  const elements: Array<Record<string, unknown>> = [];
  if (containsEmbeddedAssetLocation(value.scene.appState)) {
    return { ok: false, reason: "Project scenes must not embed image bytes or authenticated asset URLs." };
  }

  for (const element of value.scene.elements) {
    if (!isRecord(element) || typeof element.id !== "string" || typeof element.type !== "string") {
      return { ok: false, reason: "Project scene contains an invalid Excalidraw element." };
    }
    if (element.type === "image" && (typeof element.fileId !== "string" || !assetReferences[element.fileId])) {
      return { ok: false, reason: "Every Excalidraw image must reference a persisted platform asset." };
    }
    if (containsEmbeddedAssetLocation(element)) {
      return { ok: false, reason: "Project elements must not embed image bytes or authenticated asset URLs." };
    }
    elements.push(element);
  }

  return {
    ok: true,
    value: {
      format: EXCALIDRAW_PROJECT_FORMAT,
      version: EXCALIDRAW_PROJECT_VERSION,
      scene: {
        elements,
        appState: value.scene.appState
      },
      assets: assetReferences
    }
  };
}

function isCanvasAssetReference(value: unknown): value is CanvasAssetReference {
  return (
    isRecord(value) &&
    typeof value.assetId === "string" &&
    value.assetId.length > 0 &&
    typeof value.fileName === "string" &&
    value.fileName.length > 0 &&
    typeof value.mimeType === "string" &&
    /^image\/(?:png|jpeg|webp)$/u.test(value.mimeType) &&
    isPositiveNumber(value.width) &&
    isPositiveNumber(value.height) &&
    typeof value.byteSize === "number" &&
    Number.isInteger(value.byteSize) &&
    value.byteSize > 0 &&
    typeof value.contentSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.contentSha256)
  );
}

function containsEmbeddedAssetLocation(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((child) => containsEmbeddedAssetLocation(child));
  }
  if (!isRecord(value)) {
    return false;
  }
  for (const [key, child] of Object.entries(value)) {
    if (
      typeof child === "string" &&
      /^(?:data:image\/|blob:)|\/api\/assets\//u.test(child) &&
      /^(?:src|url|dataurl|dataUrl|dataURL|originalUrl)$/u.test(key)
    ) {
      return true;
    }
    if (containsEmbeddedAssetLocation(child)) {
      return true;
    }
  }
  return false;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

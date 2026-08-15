import type {
  BinaryFileData,
  BinaryFiles,
  DataURL
} from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { CanvasAssetReference } from "@gpt-image-canvas/shared";
import { apiFetch } from "../../shared/api/host-token";
import {
  assetAvailabilityRevision,
  reportAssetAvailability
} from "../../shared/assets/asset-availability";
import type { CanvasAsset, CanvasAssetId } from "./canvas-editor";

const ASSET_HYDRATION_CONCURRENCY = 4;

export interface HydratedAssets {
  files: BinaryFiles;
  assets: Map<CanvasAssetId, CanvasAsset>;
  references: Map<FileId, CanvasAssetReference>;
  unavailableAssetIds: Set<string>;
}

export async function hydrateSnapshotAssets(
  assetReferences: Record<string, CanvasAssetReference>,
  signal: AbortSignal
): Promise<HydratedAssets> {
  const references = new Map(
    Object.entries(assetReferences).map(([fileId, reference]) => [fileId as FileId, reference])
  );
  const files: BinaryFiles = {};
  const assets = new Map<CanvasAssetId, CanvasAsset>();
  const unavailableAssetIds = new Set<string>();
  const entries = Array.from(references.entries());
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(ASSET_HYDRATION_CONCURRENCY, entries.length) }, async () => {
      while (cursor < entries.length) {
        const entry = entries[cursor++];
        if (!entry) return;
        const [fileId, reference] = entry;
        assets.set(fileId, assetFromReference(fileId, reference));
        try {
          files[fileId] = await fetchAssetFile(reference, fileId, signal);
          reportAssetAvailability(
            reference.assetId,
            `/api/assets/${reference.assetId}`,
            "ready",
            assetAvailabilityRevision(reference.assetId)
          );
        } catch (error) {
          if (isAuthenticationFailure(error)) throw error;
          unavailableAssetIds.add(reference.assetId);
          reportAssetAvailability(
            reference.assetId,
            `/api/assets/${reference.assetId}`,
            "unavailable",
            assetAvailabilityRevision(reference.assetId)
          );
        }
      }
    })
  );
  return { files, assets, references, unavailableAssetIds };
}

export async function fetchAssetMetadata(assetId: string): Promise<CanvasAssetReference> {
  const response = await apiFetch(`/api/assets/${encodeURIComponent(assetId)}/metadata`);
  throwForAuthenticationFailure(response);
  if (!response.ok) throw new Error(`Asset metadata request failed (${response.status}).`);
  return { ...((await response.json()) as CanvasAssetReference), assetId };
}

export async function fetchAssetFile(
  reference: CanvasAssetReference,
  fileId: FileId,
  signal?: AbortSignal
): Promise<BinaryFileData> {
  const response = await apiFetch(`/api/assets/${encodeURIComponent(reference.assetId)}`, { signal });
  throwForAuthenticationFailure(response);
  if (!response.ok) throw new Error(`Asset request failed (${response.status}).`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== reference.mimeType) throw new Error("Asset MIME type mismatch.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== reference.byteSize) throw new Error("Asset byte size mismatch.");
  if ((await sha256(bytes)) !== reference.contentSha256) throw new Error("Asset hash mismatch.");
  const blob = new Blob([bytes], { type: reference.mimeType });
  const size = await decodedImageSize(blob);
  if (size.width !== reference.width || size.height !== reference.height) {
    throw new Error("Asset dimensions mismatch.");
  }
  return {
    id: fileId,
    dataURL: await blobToDataUrl(blob),
    mimeType: reference.mimeType as BinaryFileData["mimeType"],
    created: Date.now()
  };
}

export async function persistImportedAsset(
  file: BinaryFileData
): Promise<{ asset: CanvasAsset; reference: CanvasAssetReference }> {
  const response = await apiFetch("/api/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl: file.dataURL, fileName: fileNameForMimeType(file.id, file.mimeType) })
  });
  throwForAuthenticationFailure(response);
  if (!response.ok) throw new Error(`Canvas asset persistence failed (${response.status}).`);
  const value: unknown = await response.json();
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error("Canvas asset persistence returned an invalid response.");
  }
  const reference = await fetchAssetMetadata(value.id);
  return { asset: assetFromReference(file.id, reference), reference };
}

export function assetFromReference(fileId: FileId, reference: CanvasAssetReference): CanvasAsset {
  return {
    id: fileId,
    typeName: "asset",
    type: "image",
    props: {
      src: `/api/assets/${reference.assetId}`,
      w: reference.width,
      h: reference.height,
      name: reference.fileName,
      mimeType: reference.mimeType
    },
    meta: {
      localAssetId: reference.assetId,
      originalUrl: `/api/assets/${reference.assetId}`,
      byteSize: reference.byteSize,
      contentSha256: reference.contentSha256
    }
  };
}

export function isAuthenticationFailure(error: unknown): error is Error {
  return error instanceof AssetAuthenticationError;
}

function throwForAuthenticationFailure(response: Response): void {
  if (response.status === 401 || response.status === 403) throw new AssetAuthenticationError();
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function decodedImageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    return { width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

async function blobToDataUrl(blob: Blob): Promise<DataURL> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Asset bytes could not be decoded."));
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result as DataURL)
        : reject(new Error("Asset data URL is invalid."));
    reader.readAsDataURL(blob);
  });
}

function fileNameForMimeType(fileId: FileId, mimeType: string): string {
  const extension = mimeType === "image/png"
    ? "png"
    : mimeType === "image/jpeg"
      ? "jpg"
      : mimeType === "image/webp"
        ? "webp"
        : "bin";
  return `canvas-${fileId}.${extension}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class AssetAuthenticationError extends Error {
  constructor() {
    super("Canvas asset authentication failed.");
  }
}

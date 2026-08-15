import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import type { CanvasAssetReference } from "@gpt-image-canvas/shared";
import {
  assetAvailabilityRevision,
  reportAssetAvailability
} from "../../shared/assets/asset-availability";
import type { CanvasAsset, CanvasAssetId } from "./canvas-editor";
import {
  assetFromReference,
  fetchAssetFile,
  fetchAssetMetadata,
  isAuthenticationFailure,
  persistImportedAsset
} from "./excalidraw-asset-io";
import type { HydratedScene } from "./excalidraw-snapshot";

interface ExcalidrawAssetStoreCallbacks {
  readonly onAuthenticationFailure: () => void;
  readonly onChange: () => void;
  readonly onFileStatus: (fileId: FileId, status: "saved" | "error") => void;
}

export class ExcalidrawAssetStore {
  private filesValue: BinaryFiles;
  private readonly assets: Map<CanvasAssetId, CanvasAsset>;
  private readonly references: Map<FileId, CanvasAssetReference>;
  private readonly unavailableAssetIds: Set<string>;
  private readonly unavailableFileIds = new Set<FileId>();
  private readonly pendingAssetIds = new Set<string>();
  private readonly pendingFileIds = new Set<FileId>();

  constructor(
    private readonly api: ExcalidrawImperativeAPI,
    hydrated: HydratedScene,
    private readonly callbacks: ExcalidrawAssetStoreCallbacks
  ) {
    this.filesValue = hydrated.files;
    this.assets = hydrated.assets;
    this.references = hydrated.references;
    this.unavailableAssetIds = hydrated.unavailableAssetIds;
  }

  get files(): BinaryFiles {
    return this.filesValue;
  }

  acceptFiles(files: BinaryFiles): void {
    this.filesValue = files;
    for (const file of Object.values(files)) {
      if (!this.references.has(file.id) && !this.pendingFileIds.has(file.id)) {
        void this.persistImportedFile(file);
      }
    }
  }

  getAsset(id: CanvasAssetId): CanvasAsset | undefined {
    return this.assets.get(id);
  }

  getAssets(): CanvasAsset[] {
    return Array.from(this.assets.values());
  }

  upsertAssets(assets: CanvasAsset[]): void {
    for (const asset of assets) {
      this.assets.set(asset.id, asset);
      void this.hydrateAsset(asset);
    }
    this.callbacks.onChange();
  }

  retryAssets(assetIds?: string[]): void {
    const requested = assetIds ? new Set(assetIds) : undefined;
    for (const asset of this.assets.values()) {
      const assetId = asset.meta.localAssetId;
      if (assetId && (!requested || requested.has(assetId))) void this.hydrateAsset(asset);
    }
    if (!requested) {
      for (const fileId of this.unavailableFileIds) {
        const file = this.filesValue[fileId];
        if (file) void this.persistImportedFile(file);
      }
    }
  }

  hasUnavailableAssets(elements: readonly ExcalidrawElement[]): boolean {
    if (this.unavailableFileIds.size > 0 || this.pendingFileIds.size > 0) return true;
    if (elements.some((element) =>
      !element.isDeleted && element.type === "image" && element.fileId && !this.references.has(element.fileId)
    )) return true;
    const referencedAssetIds = new Set(
      elements.flatMap((element) => {
        if (element.isDeleted || element.type !== "image" || !element.fileId) return [];
        const reference = this.references.get(element.fileId);
        return reference ? [reference.assetId] : [];
      })
    );
    return Array.from(referencedAssetIds).some(
      (assetId) => this.unavailableAssetIds.has(assetId) || this.pendingAssetIds.has(assetId)
    );
  }

  snapshotReferences(elements: readonly ExcalidrawElement[]): Record<string, CanvasAssetReference> {
    const references: Record<string, CanvasAssetReference> = {};
    for (const element of elements) {
      if (element.isDeleted || element.type !== "image" || !element.fileId) continue;
      const reference = this.references.get(element.fileId);
      if (!reference) throw new Error("Canvas asset metadata is not ready.");
      references[element.fileId] = reference;
    }
    return references;
  }

  private async hydrateAsset(asset: CanvasAsset): Promise<void> {
    const assetId = asset.meta.localAssetId;
    if (!assetId || this.pendingAssetIds.has(assetId)) return;
    this.pendingAssetIds.add(assetId);
    try {
      const metadata = await fetchAssetMetadata(assetId);
      const reference: CanvasAssetReference = {
        assetId,
        fileName: metadata.fileName,
        mimeType: metadata.mimeType,
        width: metadata.width,
        height: metadata.height,
        byteSize: metadata.byteSize,
        contentSha256: metadata.contentSha256
      };
      const fileId = asset.id as FileId;
      const file = await fetchAssetFile(reference, fileId);
      this.references.set(fileId, reference);
      this.filesValue = { ...this.filesValue, [fileId]: file };
      this.api.addFiles([file]);
      this.callbacks.onFileStatus(fileId, "saved");
      this.unavailableAssetIds.delete(assetId);
      reportAssetAvailability(assetId, `/api/assets/${assetId}`, "ready", assetAvailabilityRevision(assetId));
    } catch (error) {
      if (isAuthenticationFailure(error)) {
        this.callbacks.onAuthenticationFailure();
        return;
      }
      this.unavailableAssetIds.add(assetId);
      this.callbacks.onFileStatus(asset.id as FileId, "error");
      reportAssetAvailability(assetId, `/api/assets/${assetId}`, "unavailable", assetAvailabilityRevision(assetId));
    } finally {
      this.pendingAssetIds.delete(assetId);
      this.callbacks.onChange();
    }
  }

  private async persistImportedFile(file: BinaryFileData): Promise<void> {
    this.pendingFileIds.add(file.id);
    try {
      const persisted = await persistImportedAsset(file);
      this.references.set(file.id, persisted.reference);
      this.assets.set(file.id, assetFromReference(file.id, persisted.reference));
      this.unavailableFileIds.delete(file.id);
      reportAssetAvailability(
        persisted.reference.assetId,
        `/api/assets/${persisted.reference.assetId}`,
        "ready",
        assetAvailabilityRevision(persisted.reference.assetId)
      );
    } catch (error) {
      if (isAuthenticationFailure(error)) {
        this.callbacks.onAuthenticationFailure();
        return;
      }
      this.unavailableFileIds.add(file.id);
    } finally {
      this.pendingFileIds.delete(file.id);
      this.callbacks.onChange();
    }
  }
}

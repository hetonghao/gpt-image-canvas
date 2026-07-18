import { apiFetch } from "../../shared/api/host-token";
import { subscribeAssetAvailability } from "../../shared/assets/asset-availability";
import { createAssetPreviewCache, type AssetPreviewCacheOptions } from "./canvas-asset-preview-cache";

const CANVAS_ASSET_UNAVAILABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" rx="12" fill="#e8e0d5"/><path d="M48 82l22-24 15 16 11-12 17 20H48zm8-41h48a8 8 0 0 1 8 8v31" fill="none" stroke="#756b62" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M44 35l72 72" stroke="#a45237" stroke-width="7" stroke-linecap="round"/></svg>`;

export const CANVAS_ASSET_UNAVAILABLE_URL = `data:image/svg+xml,${encodeURIComponent(CANVAS_ASSET_UNAVAILABLE_SVG)}`;

type CanvasAssetPreviewResolverOptions = Omit<AssetPreviewCacheOptions, "unavailableUrl"> & {
  readonly unavailableUrl?: string;
};

export function createCanvasAssetPreviewResolver(options: CanvasAssetPreviewResolverOptions) {
  return createAssetPreviewCache({
    ...options,
    unavailableUrl: options.unavailableUrl ?? CANVAS_ASSET_UNAVAILABLE_URL
  });
}

const canvasAssetPreviewResolver = createCanvasAssetPreviewResolver({
  fetchImage: apiFetch,
  decodeImage: async (blob) => {
    const bitmap = await createImageBitmap(blob);
    const isReadable = bitmap.width > 0 && bitmap.height > 0;
    bitmap.close();
    return isReadable;
  },
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url)
});
subscribeAssetAvailability((change) => {
  if (change.type === "retry") {
    canvasAssetPreviewResolver.invalidate(change.assetId);
  }
});
let canvasAssetConsumerCount = 0;
let releaseToken = 0;

export function resolveReadableCanvasAssetPreview(assetId: string, previewUrl: string): Promise<string> {
  return canvasAssetPreviewResolver.resolve(assetId, previewUrl);
}

export function retryCanvasAssetPreviews(assetId?: string): void {
  canvasAssetPreviewResolver.retry(assetId);
}

export function retainCanvasAssetPreviews(): void {
  canvasAssetConsumerCount += 1;
  releaseToken += 1;
}

export function releaseCanvasAssetPreviews(): void {
  canvasAssetConsumerCount = Math.max(0, canvasAssetConsumerCount - 1);
  const scheduledToken = ++releaseToken;
  queueMicrotask(() => {
    if (canvasAssetConsumerCount === 0 && releaseToken === scheduledToken) {
      canvasAssetPreviewResolver.release();
    }
  });
}

export function subscribeCanvasAssetPreviews(listener: () => void): () => void {
  return subscribeAssetAvailability(listener);
}

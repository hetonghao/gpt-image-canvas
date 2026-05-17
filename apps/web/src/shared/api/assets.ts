import { withHostTokenParam } from "./host-token";

export function assetPreviewUrl(assetId: string, width: number): string {
  return withHostTokenParam(`/api/assets/${encodeURIComponent(assetId)}/preview?width=${width}`);
}

export function assetDownloadUrl(assetId: string): string {
  return withHostTokenParam(`/api/assets/${encodeURIComponent(assetId)}/download`);
}

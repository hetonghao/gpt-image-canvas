import { withHostTokenParam } from "./host-token";

export function normalizeAssetUrl(url: string): string {
  return withHostTokenParam(url);
}

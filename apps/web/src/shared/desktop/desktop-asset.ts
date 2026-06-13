import type { AssetFileLocationResponse } from "@gpt-image-canvas/shared";
import { apiFetch } from "../api/host-token";
import { isTauriRuntime } from "./desktop-runtime";

type RevealItemInDir = (path: string | string[]) => Promise<void>;

export async function revealDesktopAssetFile(
  assetId: string,
  options: {
    fetcher?: typeof fetch;
    revealItemInDir?: RevealItemInDir;
  } = {}
): Promise<boolean> {
  if (!isTauriRuntime()) {
    return false;
  }

  const fetcher = options.fetcher ?? apiFetch;
  const response = await fetcher(`/api/assets/${encodeURIComponent(assetId)}/location`);
  if (!response.ok) {
    throw new Error(await readDesktopAssetError(response));
  }

  const body = (await response.json()) as Partial<AssetFileLocationResponse>;
  if (typeof body.filePath !== "string" || !body.filePath.trim()) {
    throw new Error("Asset file path is unavailable.");
  }

  const revealItemInDir = options.revealItemInDir ?? (await loadRevealItemInDir());
  await revealItemInDir(body.filePath);
  return true;
}

async function loadRevealItemInDir(): Promise<RevealItemInDir> {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  return revealItemInDir;
}

async function readDesktopAssetError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: { message?: string } }
    | undefined;
  return body?.error?.message || `Asset location request failed with status ${response.status}.`;
}

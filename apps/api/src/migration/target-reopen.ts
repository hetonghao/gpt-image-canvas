import { readFileSync } from "node:fs";
import { assetPath, verifyAssetBytes } from "./assets.js";
import { isRecord, numberValue, recordValue, stringValue } from "./json.js";
import type { AssetRow, JsonRecord } from "./types.js";

type TargetSnapshot = {
  readonly format: "ai-cove-excalidraw";
  readonly version: 1;
  readonly scene: {
    readonly elements: readonly JsonRecord[];
    readonly appState: JsonRecord;
  };
  readonly assets: JsonRecord;
};

type HydrationInput = {
  readonly outputDir: string;
  readonly userId: string;
  readonly snapshot: TargetSnapshot;
  readonly assets: readonly AssetRow[];
};

type HydratedTarget = {
  readonly snapshot: TargetSnapshot;
  readonly files: ReadonlyMap<string, Uint8Array>;
};

export async function reopenTargetProject(input: {
  readonly outputDir: string;
  readonly userId: string;
  readonly snapshotJson: string;
  readonly assets: readonly AssetRow[];
}): Promise<boolean> {
  const initial = restoreTargetSnapshot(input.snapshotJson);
  if (!initial) return false;
  const first = await hydrateTargetSnapshot({ ...input, snapshot: initial });
  if (!first) return false;
  const firstSerialized = serializeTargetSnapshot(first.snapshot);
  const restored = restoreTargetSnapshot(firstSerialized);
  if (!restored) return false;
  const second = await hydrateTargetSnapshot({ ...input, snapshot: restored });
  return second !== undefined && firstSerialized === serializeTargetSnapshot(second.snapshot);
}

function restoreTargetSnapshot(snapshotJson: string): TargetSnapshot | undefined {
  try {
    return parseTargetSnapshot(JSON.parse(snapshotJson));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function parseTargetSnapshot(value: unknown): TargetSnapshot | undefined {
  if (!isRecord(value) || value.format !== "ai-cove-excalidraw" || value.version !== 1) return undefined;
  const scene = recordValue(value.scene);
  const rawElements = scene?.elements;
  const appState = recordValue(scene?.appState);
  const assets = recordValue(value.assets);
  if (!scene || !Array.isArray(rawElements) || !appState || !assets) return undefined;
  const elements = rawElements.flatMap((element) => isRecord(element) ? [element] : []);
  return elements.length === rawElements.length ? { format: "ai-cove-excalidraw", version: 1, scene: { elements, appState }, assets } : undefined;
}

async function hydrateTargetSnapshot(input: HydrationInput): Promise<HydratedTarget | undefined> {
  const assetsById = new Map(input.assets.map((asset) => [asset.id, asset]));
  const files = new Map<string, Uint8Array>();
  for (const [fileId, value] of Object.entries(input.snapshot.assets)) {
    const assetId = isRecord(value) ? stringValue(value.assetId) : undefined;
    const asset = assetId ? assetsById.get(assetId) : undefined;
    if (!asset || asset.userId !== input.userId || !validAssetReference(fileId, value, asset)) return undefined;
    const path = assetPath(input.outputDir, asset);
    if (!path) return undefined;
    try {
      const bytes = readFileSync(path);
      if ((await verifyAssetBytes(input.userId, asset, bytes)).kind === "blocked") return undefined;
      files.set(fileId, bytes);
    } catch (error) {
      if (error instanceof Error) return undefined;
      throw error;
    }
  }
  for (const element of input.snapshot.scene.elements) {
    if (element.type !== "image") continue;
    const fileId = stringValue(element.fileId);
    const width = numberValue(element.width);
    const height = numberValue(element.height);
    if (!fileId || !files.has(fileId) || width === undefined || width <= 0 || height === undefined || height <= 0) return undefined;
  }
  return { snapshot: input.snapshot, files };
}

function serializeTargetSnapshot(snapshot: TargetSnapshot): string {
  return JSON.stringify(snapshot);
}

function validAssetReference(fileId: string, value: unknown, asset: AssetRow): boolean {
  if (!fileId || !isRecord(value)) return false;
  return (
    stringValue(value.fileName) === asset.fileName &&
    stringValue(value.mimeType) === asset.mimeType &&
    numberValue(value.width) === asset.width &&
    numberValue(value.height) === asset.height &&
    nullableNumber(value.byteSize) === asset.byteSize &&
    nullableString(value.contentSha256) === asset.contentSha256
  );
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null ? null : numberValue(value);
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : stringValue(value);
}

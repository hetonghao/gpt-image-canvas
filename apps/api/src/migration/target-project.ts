import { validateExcalidrawProjectSnapshot } from "@gpt-image-canvas/shared";
import { verifyAsset } from "./assets.js";
import type { AssetRow, ConversionOutcome, JsonRecord, ProjectRow, VerifiedAsset } from "./types.js";

type TargetProjectInput = {
  readonly inputDir: string;
  readonly project: ProjectRow;
  readonly parsed: JsonRecord;
  readonly assets: ReadonlyMap<string, AssetRow>;
};

export async function preserveTargetProject(input: TargetProjectInput): Promise<ConversionOutcome | undefined> {
  if (input.parsed.format !== "ai-cove-excalidraw") return undefined;
  const validation = validateExcalidrawProjectSnapshot(input.parsed);
  if (!validation.ok || validation.value === null) return blocked(input.project, "invalid_snapshot");
  const verified = new Map<string, VerifiedAsset>();
  for (const reference of Object.values(validation.value.assets)) {
    const asset = input.assets.get(reference.assetId);
    if (!asset || asset.userId !== input.project.userId) return blocked(input.project, "asset_missing");
    const result = await verifyAsset(input.inputDir, input.project.userId, asset);
    if (result.kind === "blocked") return blocked(input.project, result.code);
    if (
      reference.fileName !== result.value.fileName ||
      reference.mimeType !== result.value.mimeType ||
      reference.width !== result.value.actualWidth ||
      reference.height !== result.value.actualHeight ||
      reference.byteSize !== result.value.actualByteSize ||
      reference.contentSha256 !== result.value.actualContentSha256
    ) return blocked(input.project, "asset_materialization_failed");
    verified.set(result.value.id, result.value);
  }
  return {
    kind: "converted",
    value: {
      ...input.project,
      sourceShapeCount: 0,
      targetElementCount: validation.value.scene.elements.length,
      assetReferences: Object.keys(validation.value.assets).length,
      verifiedAssets: [...verified.values()],
      warnings: []
    }
  };
}

function blocked(project: ProjectRow, code: "asset_materialization_failed" | "asset_missing" | "invalid_snapshot"): ConversionOutcome {
  return {
    kind: "blocked",
    value: {
      id: project.id,
      userId: project.userId,
      sourceShapeCount: 0,
      targetElementCount: 0,
      assetReferences: 0,
      verifiedAssets: [],
      warnings: [],
      failures: [code]
    }
  };
}

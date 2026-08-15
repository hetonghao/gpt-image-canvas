import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { resolutionTierForSize } from "../contracts.js";
import type {
  AssetMetadataResponse,
  GeneratedAsset,
  GeneratedAssetCloudInfo,
  GenerationOutput,
  GenerationRecord,
  GenerationStatus,
  ImageMode,
  ImageQuality,
  ImageSize,
  OutputStatus,
  OutputFormat,
  ProviderSourceId,
  ReferenceImageInput
} from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import {
  ProviderError,
  type EditImageProviderInput,
  type ImageProvider,
  type ImageModelRoute,
  type ImageProviderInput,
  type ProviderImage
} from "../../infrastructure/providers/image-provider.js";
import {
  CosAssetStorageAdapter,
  LocalAssetStorageAdapter,
  S3CompatibleAssetStorageAdapter,
  buildCloudObjectKey,
  storageErrorMessage,
  type CosAssetLocation,
  type S3AssetLocation
} from "../../infrastructure/storage/asset-storage.js";
import { runtimePaths } from "../../infrastructure/runtime.js";
import { assets, generationOutputs, generationRecords, generationReferenceAssets } from "../../infrastructure/schema.js";
import { getActiveCloudStorageConfig } from "../storage/storage-config.js";
import type { HostContext } from "../host/host-adapter.js";

const BATCH_CONCURRENCY = 2;
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const INTERRUPTED_GENERATION_ERROR = "Generation was interrupted by an API restart. Rerun it from history.";
const CANCELLED_GENERATION_ERROR = "This generation was cancelled.";
const localAssetStorage = new LocalAssetStorageAdapter();
const activeReferenceGenerationStarts = new Map<string, Promise<RunningReferenceGeneration>>();

export interface StoredAssetFile {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize?: number;
  contentSha256?: string;
  cloud?: StoredCloudAssetLocation;
}

interface BatchOutputResult {
  id: string;
  status: "succeeded" | "failed";
  model?: string;
  retryCount?: number;
  asset?: GeneratedAsset;
  cloudStorage?: AssetCloudStorageRecord;
  error?: string;
}

interface SavedProviderImage {
  asset: GeneratedAsset;
  cloudStorage?: AssetCloudStorageRecord;
}

interface AssetCloudStorageRecord {
  provider: "cos" | "s3";
  bucket: string;
  region: string;
  objectKey: string;
  status: "uploaded" | "failed";
  endpoint?: string;
  forcePathStyle?: boolean;
  error?: string;
  uploadedAt?: string;
  etag?: string;
  requestId?: string;
}

type StoredCloudAssetLocation =
  | ({
      provider: "cos";
    } & CosAssetLocation)
  | ({
      provider: "s3";
    } & S3AssetLocation);

type PersistedGenerationInput = ImageProviderInput & {
  mode: "generate" | "edit";
  resolutionTier?: ImageModelRoute["tier"];
  model?: string;
  providerSourceId?: ProviderSourceId;
  modelFallback?: boolean;
  referenceAssetIds?: string[];
  referenceAssetId?: string;
};

type RunningReferenceGeneration = {
  record: GenerationRecord;
  input: EditImageProviderInput;
};

export function createRunningTextToImageGeneration(
  input: ImageProviderInput,
  hostContext?: HostContext,
  provider?: ImageProvider
): GenerationRecord {
  const persistedInput: PersistedGenerationInput = {
    ...input,
    mode: "generate"
  };
  return createRunningGenerationRecord(provider ? withProviderRoute(persistedInput, provider) : persistedInput, hostContext);
}

export async function createRunningReferenceImageGeneration(
  input: EditImageProviderInput,
  hostContext?: HostContext,
  provider?: ImageProvider
): Promise<RunningReferenceGeneration> {
  const clientRequestId = input.clientRequestId?.trim();
  const existing = clientRequestId ? readGenerationRecordByClientRequestId(clientRequestId, hostContext) : undefined;
  if (existing) {
    const referenceAssetIds = existing.referenceAssetIds ?? (existing.referenceAssetId ? [existing.referenceAssetId] : undefined);
    return {
      record: existing,
      input: referenceAssetIds
        ? { ...input, referenceAssetIds, referenceAssetId: referenceAssetIds[0] }
        : input
    };
  }

  const startKey = clientRequestId ? `${hostUserId(hostContext)}\u0000${clientRequestId}` : undefined;
  const activeStart = startKey ? activeReferenceGenerationStarts.get(startKey) : undefined;
  if (activeStart) {
    return activeStart;
  }

  const start = persistRunningReferenceImageGeneration(input, hostContext, provider);
  if (startKey) {
    activeReferenceGenerationStarts.set(startKey, start);
  }
  try {
    return await start;
  } finally {
    if (startKey && activeReferenceGenerationStarts.get(startKey) === start) {
      activeReferenceGenerationStarts.delete(startKey);
    }
  }
}

async function persistRunningReferenceImageGeneration(
  input: EditImageProviderInput,
  hostContext?: HostContext,
  provider?: ImageProvider
): Promise<RunningReferenceGeneration> {
  const referenceAssetIds = await ensureReferenceAssetIds(input, hostContext);
  const inputWithReferenceAssets: EditImageProviderInput = {
    ...input,
    referenceAssetIds,
    referenceAssetId: referenceAssetIds[0]
  };

  return {
    record: createRunningGenerationRecord(provider ? withProviderRoute({
      ...inputWithReferenceAssets,
      mode: "edit"
    }, provider) : {
      ...inputWithReferenceAssets,
      mode: "edit"
    }, hostContext),
    input: inputWithReferenceAssets
  };
}

export async function finishTextToImageGeneration(
  generationId: string,
  input: ImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal,
  hostContext?: HostContext
): Promise<GenerationRecord> {
  const persistedInput = withProviderRoute({ ...input, mode: "generate" }, provider);
  updateGenerationRecordRoute(generationId, persistedInput, hostContext);
  const outputs = await mapWithConcurrency(
    Array.from({ length: input.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => generateSingleOutput(input, provider, signal, hostContext)
  );
  throwIfAborted(signal);

  return completeGenerationRecord(
    generationId,
    persistedInput,
    outputs,
    hostContext
  );
}

export async function finishReferenceImageGeneration(
  generationId: string,
  input: EditImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal,
  hostContext?: HostContext
): Promise<GenerationRecord> {
  const persistedInput = withProviderRoute({ ...input, mode: "edit" }, provider);
  updateGenerationRecordRoute(generationId, persistedInput, hostContext);
  const outputs = await mapWithConcurrency(
    Array.from({ length: input.count }, (_, index) => index),
    BATCH_CONCURRENCY,
    async () => editSingleOutput(input, provider, signal, hostContext)
  );
  throwIfAborted(signal);

  return completeGenerationRecord(
    generationId,
    persistedInput,
    outputs,
    hostContext
  );
}

export function getGenerationRecord(generationId: string, hostContext?: HostContext): GenerationRecord | undefined {
  return readGenerationRecord(generationId, hostContext);
}

export function listGenerationRecords(hostContext?: HostContext): GenerationRecord[] {
  return db
    .select()
    .from(generationRecords)
    .where(eq(generationRecords.userId, hostUserId(hostContext)))
    .orderBy(desc(generationRecords.createdAt))
    .limit(20)
    .all()
    .map((record) => materializeGenerationRecord(record, hostContext));
}

export function cancelGenerationRecord(generationId: string, hostContext?: HostContext): GenerationRecord | undefined {
  return updateGenerationRecordStatus(generationId, "cancelled", CANCELLED_GENERATION_ERROR, hostContext);
}

export function failGenerationRecord(generationId: string, error: unknown, hostContext?: HostContext): GenerationRecord | undefined {
  return updateGenerationRecordStatus(generationId, "failed", generationFailureMessage(error), hostContext);
}

export function markInterruptedGenerationRecordsFailed(): void {
  db.update(generationRecords)
    .set({
      status: "failed",
      error: INTERRUPTED_GENERATION_ERROR
    })
    .where(inArray(generationRecords.status, ["pending", "running"]))
    .run();
}

async function ensureReferenceAssetIds(input: EditImageProviderInput, hostContext?: HostContext): Promise<string[]> {
  return Promise.all(
    input.referenceImages.map(async (referenceImage, index) => {
      const existingAssetId = persistedReferenceAssetId(input.referenceAssetIds?.[index], hostContext);
      if (existingAssetId) {
        return existingAssetId;
      }

      const savedReferenceAsset = await saveReferenceImageInput(referenceImage, hostContext);
      return savedReferenceAsset.id;
    })
  );
}

function persistedReferenceAssetId(assetId: string | undefined, hostContext?: HostContext): string | undefined {
  const trimmedAssetId = assetId?.trim();
  if (!trimmedAssetId) {
    return undefined;
  }

  const asset = db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.id, trimmedAssetId), eq(assets.userId, hostUserId(hostContext))))
    .get();
  if (asset?.id) {
    return asset.id;
  }

  return undefined;
}

export async function saveReferenceImageInput(input: ReferenceImageInput, hostContext?: HostContext): Promise<GeneratedAsset> {
  return saveImageAssetInput(input, hostContext);
}

export async function saveUploadedImageAsset(input: ReferenceImageInput, hostContext?: HostContext): Promise<GeneratedAsset> {
  return saveImageAssetInput(input, hostContext);
}

async function saveImageAssetInput(input: ReferenceImageInput, hostContext?: HostContext): Promise<GeneratedAsset> {
  const parsed = referenceDataUrlToBytes(input);
  const saved = await persistImageAssetBytes(
    {
      bytes: parsed.bytes,
      fileName: input.fileName,
      invalidImageMessage: "Reference image dimensions could not be read.",
      invalidImageStatus: 400
    },
    hostContext
  );
  return saved.asset;
}

function fileNameForAsset(inputFileName: string | undefined, assetId: string, extension: string): string {
  const fallback = `${assetId}.${extension}`;
  const baseName = inputFileName?.trim().split(/[\\/]/u).filter(Boolean).at(-1);
  if (!baseName) {
    return fallback;
  }

  const cleaned = baseName.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  if (!cleaned) {
    return fallback;
  }

  const withoutExtension = cleaned.replace(/\.[a-z0-9]{1,8}$/iu, "").trim();
  return `${(withoutExtension || assetId).slice(0, 120)}.${extension}`;
}

function referenceDataUrlToBytes(input: ReferenceImageInput): { bytes: Buffer; mimeType: string } {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(input.dataUrl);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像格式不受支持。", 400);
  }

  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType)) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像必须是 PNG、JPEG 或 WebP 格式。", 400);
  }

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像不能超过 50MB。", 400);
  }

  return {
    bytes,
    mimeType: mimeType === "image/jpg" ? "image/jpeg" : mimeType
  };
}

function extensionForMimeType(mimeType: string): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1] || "png";
}

export function getStoredAssetFile(assetId: string, hostContext?: HostContext): StoredAssetFile | undefined {
  const asset = db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.userId, hostUserId(hostContext)))).get();
  if (!asset) {
    return undefined;
  }

  const filePath = resolve(runtimePaths.dataDir, asset.relativePath);
  if (!isInsideDirectory(filePath, runtimePaths.assetsDir)) {
    return undefined;
  }

  return {
    id: asset.id,
    fileName: asset.fileName,
    filePath,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    byteSize: asset.byteSize ?? undefined,
    contentSha256: asset.contentSha256 ?? undefined,
    cloud: toCloudAssetLocation(asset)
  };
}

export async function readStoredAsset(assetId: string, hostContext?: HostContext): Promise<{ file: StoredAssetFile; bytes: Buffer } | undefined> {
  const file = getStoredAssetFile(assetId, hostContext);
  if (!file) {
    return undefined;
  }

  try {
    return {
      file,
      bytes: await localAssetStorage.getObject({ filePath: file.filePath })
    };
  } catch {
    const bytes = await readCloudAsset(file.cloud, hostContext);
    if (!bytes) {
      return undefined;
    }

    void localAssetStorage.putObject({ filePath: file.filePath, bytes }).catch(() => undefined);
    return {
      file,
      bytes
    };
  }
}

export async function readStoredAssetMetadata(assetId: string, hostContext?: HostContext): Promise<AssetMetadataResponse | undefined> {
  const asset = await readStoredAsset(assetId, hostContext);
  if (!asset) {
    return undefined;
  }

  const size = await readImageSize(asset.bytes);
  if (!size) {
    return undefined;
  }

  return {
    id: asset.file.id,
    fileName: asset.file.fileName,
    mimeType: asset.file.mimeType,
    width: size.width,
    height: size.height,
    byteSize: asset.bytes.byteLength,
    contentSha256: createHash("sha256").update(asset.bytes).digest("hex")
  };
}

async function generateSingleOutput(
  input: ImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal,
  hostContext?: HostContext
): Promise<BatchOutputResult> {
  const outputId = randomUUID();

  try {
    throwIfAborted(signal);
    const result = await provider.generate(
      {
        ...input,
        count: 1
      },
      signal
    );
    throwIfAborted(signal);

    const providerImage = result.images[0];
    if (!providerImage) {
      throw new ProviderError("unsupported_provider_behavior", "上游图像服务没有返回图像结果。", 502);
    }

    const saved = await saveProviderImage(providerImage, input, signal, hostContext);

    return {
      id: outputId,
      status: "succeeded",
      model: result.model,
      retryCount: result.retryCount,
      asset: saved.asset,
      cloudStorage: saved.cloudStorage
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw error;
    }

    return {
      id: outputId,
      status: "failed",
      retryCount: error instanceof ProviderError ? error.retryCount : undefined,
      error: generationFailureMessage(error)
    };
  }
}

async function editSingleOutput(
  input: EditImageProviderInput,
  provider: ImageProvider,
  signal?: AbortSignal,
  hostContext?: HostContext
): Promise<BatchOutputResult> {
  const outputId = randomUUID();

  try {
    throwIfAborted(signal);
    const result = await provider.edit(
      {
        ...input,
        count: 1
      },
      signal
    );
    throwIfAborted(signal);

    const providerImage = result.images[0];
    if (!providerImage) {
      throw new ProviderError("unsupported_provider_behavior", "上游图像服务没有返回图像结果。", 502);
    }

    const saved = await saveProviderImage(providerImage, input, signal, hostContext);

    return {
      id: outputId,
      status: "succeeded",
      model: result.model,
      retryCount: result.retryCount,
      asset: saved.asset,
      cloudStorage: saved.cloudStorage
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      throw error;
    }

    return {
      id: outputId,
      status: "failed",
      retryCount: error instanceof ProviderError ? error.retryCount : undefined,
      error: generationFailureMessage(error)
    };
  }
}

async function saveProviderImage(
  image: ProviderImage,
  input: ImageProviderInput,
  _signal?: AbortSignal,
  hostContext?: HostContext
): Promise<SavedProviderImage> {
  const bytes = Buffer.from(image.b64Json, "base64");
  return persistImageAssetBytes(
    {
      bytes,
      fileName: `generated.${input.outputFormat === "jpeg" ? "jpg" : input.outputFormat}`,
      invalidImageMessage: "Generated image dimensions could not be read.",
      invalidImageStatus: 502
    },
    hostContext
  );
}

async function persistImageAssetBytes(
  input: {
    bytes: Buffer;
    fileName?: string;
    invalidImageMessage: string;
    invalidImageStatus: number;
  },
  hostContext?: HostContext
): Promise<SavedProviderImage> {
  const image = await inspectImage(input.bytes);
  if (!image) {
    throw new ProviderError("unsupported_provider_behavior", input.invalidImageMessage, input.invalidImageStatus);
  }

  const userId = hostUserId(hostContext);
  const contentSha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = db
    .select()
    .from(assets)
    .where(and(eq(assets.userId, userId), eq(assets.contentSha256, contentSha256)))
    .get();
  if (existing) {
    return {
      asset: toGeneratedAsset(existing)!
    };
  }

  const assetId = randomUUID();
  const extension = extensionForMimeType(image.mimeType);
  const fileName = fileNameForAsset(input.fileName, assetId, extension);
  const relativePath = `assets/${assetId}.${extension}`;
  const filePath = resolve(runtimePaths.dataDir, relativePath);
  const createdAt = new Date().toISOString();

  await localAssetStorage.putObject({ filePath, bytes: input.bytes });
  const cloudStorage = await saveAssetToConfiguredCloud(
    {
      fileName,
      bytes: input.bytes,
      mimeType: image.mimeType,
      createdAt
    },
    hostContext
  );

  db.insert(assets)
    .values({
      id: assetId,
      userId,
      fileName,
      relativePath,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      byteSize: input.bytes.byteLength,
      contentSha256,
      cloudProvider: cloudStorage?.provider ?? null,
      cloudBucket: cloudStorage?.bucket ?? null,
      cloudRegion: cloudStorage?.region ?? null,
      cloudObjectKey: cloudStorage?.objectKey ?? null,
      cloudStatus: cloudStorage?.status ?? null,
      cloudError: cloudStorage?.error ?? null,
      cloudUploadedAt: cloudStorage?.uploadedAt ?? null,
      cloudEtag: cloudStorage?.etag ?? null,
      cloudRequestId: cloudStorage?.requestId ?? null,
      cloudEndpoint: cloudStorage?.endpoint ?? null,
      cloudForcePathStyle: cloudStorage?.provider === "s3" ? (cloudStorage.forcePathStyle ? 1 : 0) : null,
      createdAt
    })
    .run();

  return {
    asset: {
      id: assetId,
      url: `/api/assets/${assetId}`,
      fileName,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      byteSize: input.bytes.byteLength,
      contentSha256,
      cloud: toGeneratedAssetCloud(cloudStorage)
    },
    cloudStorage
  };
}

async function inspectImage(bytes: Buffer): Promise<(ImageSize & { mimeType: string }) | undefined> {
  try {
    const metadata = await sharp(bytes).metadata();
    const mimeType = metadata.format === "jpeg" ? "image/jpeg" : metadata.format === "png" ? "image/png" : metadata.format === "webp" ? "image/webp" : undefined;
    if (!metadata.width || !metadata.height || !mimeType) {
      return undefined;
    }

    return {
      width: metadata.width,
      height: metadata.height,
      mimeType
    };
  } catch {
    return undefined;
  }
}

async function readImageSize(bytes: Buffer): Promise<ImageSize | undefined> {
  const image = await inspectImage(bytes);
  return image ? { width: image.width, height: image.height } : undefined;
}

function withProviderRoute(input: PersistedGenerationInput, provider: ImageProvider): PersistedGenerationInput {
  const route = provider.resolveModelRoute?.(input.size);
  if (!route) {
    return input;
  }

  return {
    ...input,
    resolutionTier: route.tier,
    model: route.model,
    providerSourceId: provider.sourceId,
    modelFallback: route.fallbackToDefault
  };
}

function updateGenerationRecordRoute(generationId: string, input: PersistedGenerationInput, hostContext?: HostContext): void {
  const storedGenerationId = findGenerationRecordRow(generationId, hostContext)?.id;
  if (!storedGenerationId) {
    return;
  }
  db.update(generationRecords)
    .set({
      resolutionTier: input.resolutionTier ?? resolutionTierForSize(input.size),
      model: input.model ?? null,
      providerSourceId: input.providerSourceId ?? null,
      modelFallback: input.modelFallback === undefined ? null : input.modelFallback ? 1 : 0
    })
    .where(and(eq(generationRecords.id, storedGenerationId), eq(generationRecords.userId, hostUserId(hostContext))))
    .run();
}

function createRunningGenerationRecord(input: PersistedGenerationInput, hostContext?: HostContext): GenerationRecord {
  const createdAt = new Date().toISOString();
  const userId = hostUserId(hostContext);
  const clientRequestId = input.clientRequestId?.trim() || undefined;
  const existing = clientRequestId ? readGenerationRecordByClientRequestId(clientRequestId, hostContext) : undefined;
  if (existing) {
    return existing;
  }
  const generationId = clientRequestId && userId === "standalone" ? clientRequestId : newGenerationStorageId(hostContext);

  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : []);
  const primaryReferenceAssetId = referenceAssetIds[0] ?? input.referenceAssetId;

  db.insert(generationRecords)
    .values({
      id: generationId,
      userId,
      clientRequestId: clientRequestId ?? null,
      mode: input.mode,
      prompt: input.originalPrompt,
      effectivePrompt: input.prompt,
      presetId: input.presetId,
      width: input.size.width,
      height: input.size.height,
      resolutionTier: input.resolutionTier ?? resolutionTierForSize(input.size),
      model: input.model ?? null,
      providerSourceId: input.providerSourceId ?? null,
      modelFallback: input.modelFallback === undefined ? null : input.modelFallback ? 1 : 0,
      quality: input.quality,
      outputFormat: input.outputFormat,
      count: input.count,
      status: "running",
      error: null,
      retryCount: 0,
      referenceAssetId: primaryReferenceAssetId ?? null,
      createdAt
    })
    .run();

  referenceAssetIds.forEach((assetId, position) => {
    db.insert(generationReferenceAssets)
      .values({
        generationId,
        assetId,
        position,
        createdAt
      })
      .run();
  });

  return {
    id: clientRequestId ?? generationId,
    mode: input.mode,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt,
    presetId: input.presetId,
    size: input.size,
    resolutionTier: input.resolutionTier ?? resolutionTierForSize(input.size),
    model: input.model,
    providerSourceId: input.providerSourceId,
    modelFallback: input.modelFallback,
    quality: input.quality,
    outputFormat: input.outputFormat,
    count: input.count,
    status: "running",
    retryCount: 0,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
    referenceAssetId: primaryReferenceAssetId,
    createdAt,
    outputs: []
  };
}

function completeGenerationRecord(
  generationId: string,
  input: PersistedGenerationInput,
  outputs: BatchOutputResult[],
  hostContext?: HostContext
): GenerationRecord {
  const existing = readGenerationRecord(generationId, hostContext);
  const storedGenerationId = findGenerationRecordRow(generationId, hostContext)?.id ?? generationId;
  if (existing && isTerminalGenerationStatus(existing.status)) {
    return existing;
  }

  const successCount = outputs.filter((output) => output.status === "succeeded").length;
  const failureCount = outputs.length - successCount;
  const status = resolveGenerationStatus(successCount, failureCount);
  const error = failureCount > 0 ? outputs.find((output) => output.status === "failed" && output.error)?.error ?? `${failureCount} images failed.` : undefined;
  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : []);
  const primaryReferenceAssetId = referenceAssetIds[0] ?? input.referenceAssetId;
  const model = outputs.find((output) => output.model)?.model;
  const retryCount = outputs.reduce((total, output) => total + (output.retryCount ?? 0), 0);

  db.update(generationRecords)
    .set({
      status,
      error: error ?? null,
      retryCount,
      resolutionTier: input.resolutionTier ?? resolutionTierForSize(input.size),
      model: model ?? input.model ?? existing?.model ?? null,
      providerSourceId: input.providerSourceId ?? existing?.providerSourceId ?? null,
      modelFallback:
        input.modelFallback === undefined
          ? existing?.modelFallback === undefined
            ? null
            : existing.modelFallback
              ? 1
              : 0
          : input.modelFallback
            ? 1
            : 0,
      referenceAssetId: primaryReferenceAssetId ?? null
    })
    .where(and(eq(generationRecords.id, storedGenerationId), eq(generationRecords.userId, hostUserId(hostContext))))
    .run();

  db.delete(generationOutputs).where(eq(generationOutputs.generationId, storedGenerationId)).run();

  insertGenerationOutputs(storedGenerationId, outputs, hostContext);

  return readGenerationRecord(storedGenerationId, hostContext) ?? {
    id: input.clientRequestId ?? generationId,
    mode: input.mode,
    prompt: input.originalPrompt,
    effectivePrompt: input.prompt,
    presetId: input.presetId,
    size: input.size,
    resolutionTier: input.resolutionTier ?? resolutionTierForSize(input.size),
    model: model ?? input.model,
    providerSourceId: input.providerSourceId,
    modelFallback: input.modelFallback,
    quality: input.quality,
    outputFormat: input.outputFormat,
    count: input.count,
    status,
    error,
    retryCount,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : undefined,
    referenceAssetId: primaryReferenceAssetId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    outputs: outputs.map(toGenerationOutput)
  };
}

function insertGenerationOutputs(generationId: string, outputs: BatchOutputResult[], hostContext?: HostContext): void {
  const createdAt = new Date().toISOString();

  for (const output of outputs) {
    db.insert(generationOutputs)
      .values({
        id: output.id,
        generationId,
        status: output.status,
        assetId: output.asset?.id ?? null,
        error: output.error ?? null,
        createdAt
      })
      .run();
  }
}

function updateGenerationRecordStatus(
  generationId: string,
  status: Extract<GenerationStatus, "cancelled" | "failed">,
  error: string,
  hostContext?: HostContext
): GenerationRecord | undefined {
  const existing = readGenerationRecord(generationId, hostContext);
  const storedGenerationId = findGenerationRecordRow(generationId, hostContext)?.id;
  if (!existing || !storedGenerationId) {
    return undefined;
  }

  if (isTerminalGenerationStatus(existing.status)) {
    return existing;
  }

  db.update(generationRecords)
    .set({
      status,
      error
    })
    .where(and(eq(generationRecords.id, storedGenerationId), eq(generationRecords.userId, hostUserId(hostContext))))
    .run();

  return readGenerationRecord(storedGenerationId, hostContext);
}

function isTerminalGenerationStatus(status: GenerationStatus): boolean {
  return status === "succeeded" || status === "partial" || status === "failed" || status === "cancelled";
}

function readGenerationRecord(generationId: string, hostContext?: HostContext): GenerationRecord | undefined {
  const record = findGenerationRecordRow(generationId, hostContext);
  if (!record) {
    return undefined;
  }
  return materializeGenerationRecord(record, hostContext);
}

function materializeGenerationRecord(
  record: typeof generationRecords.$inferSelect,
  hostContext?: HostContext
): GenerationRecord {
  const outputRows = db
    .select()
    .from(generationOutputs)
    .where(eq(generationOutputs.generationId, record.id))
    .orderBy(generationOutputs.createdAt)
    .all();
  const referenceRows = db
    .select()
    .from(generationReferenceAssets)
    .where(eq(generationReferenceAssets.generationId, record.id))
    .all()
    .sort((left, right) => left.position - right.position);
  const assetIds = outputRows.flatMap((output) => (output.assetId ? [output.assetId] : []));
  const assetRows =
    assetIds.length > 0
      ? db.select().from(assets).where(and(inArray(assets.id, assetIds), eq(assets.userId, hostUserId(hostContext)))).all()
      : [];
  const assetById = new Map(assetRows.map((asset) => [asset.id, asset]));
  const referenceAssetIds = referenceRows.map((referenceRow) => referenceRow.assetId);

  return {
    id: record.clientRequestId ?? record.id,
    mode: record.mode as ImageMode,
    prompt: record.prompt,
    effectivePrompt: record.effectivePrompt,
    presetId: record.presetId,
    size: {
      width: record.width,
      height: record.height
    },
    resolutionTier: record.resolutionTier === "1K" || record.resolutionTier === "2K" || record.resolutionTier === "4K" ? record.resolutionTier : undefined,
    model: record.model ?? undefined,
    providerSourceId:
      record.providerSourceId === "env-openai" || record.providerSourceId === "local-openai" || record.providerSourceId === "codex"
        ? record.providerSourceId
        : undefined,
    modelFallback: record.modelFallback === null ? undefined : record.modelFallback === 1,
    quality: record.quality as ImageQuality,
    outputFormat: record.outputFormat as OutputFormat,
    count: record.count,
    status: record.status as GenerationStatus,
    error: record.error ?? undefined,
    retryCount: record.retryCount,
    referenceAssetIds: referenceAssetIds.length > 0 ? referenceAssetIds : record.referenceAssetId ? [record.referenceAssetId] : undefined,
    referenceAssetId: record.referenceAssetId ?? undefined,
    createdAt: record.createdAt,
    outputs: outputRows.map((output) => ({
      id: output.id,
      status: output.status as OutputStatus,
      asset: output.assetId ? toGeneratedAsset(assetById.get(output.assetId)) : undefined,
      error: output.error ?? undefined
    }))
  };
}

function findGenerationRecordRow(generationId: string, hostContext?: HostContext): typeof generationRecords.$inferSelect | undefined {
  const userId = hostUserId(hostContext);
  const clientRequestRecord = db
    .select()
    .from(generationRecords)
    .where(and(eq(generationRecords.userId, userId), eq(generationRecords.clientRequestId, generationId)))
    .get();
  if (clientRequestRecord) {
    return clientRequestRecord;
  }
  return db
    .select()
    .from(generationRecords)
    .where(and(eq(generationRecords.userId, userId), eq(generationRecords.id, generationId)))
    .get();
}

function readGenerationRecordByClientRequestId(clientRequestId: string, hostContext?: HostContext): GenerationRecord | undefined {
  const record = db
    .select()
    .from(generationRecords)
    .where(and(eq(generationRecords.userId, hostUserId(hostContext)), eq(generationRecords.clientRequestId, clientRequestId)))
    .get();
  return record ? materializeGenerationRecord(record, hostContext) : undefined;
}

function toGeneratedAsset(asset: (typeof assets.$inferSelect) | undefined): GeneratedAsset | undefined {
  if (!asset) {
    return undefined;
  }

  return {
    id: asset.id,
    url: `/api/assets/${asset.id}`,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    byteSize: asset.byteSize ?? undefined,
    contentSha256: asset.contentSha256 ?? undefined,
    cloud:
      (asset.cloudProvider === "cos" || asset.cloudProvider === "s3") && (asset.cloudStatus === "uploaded" || asset.cloudStatus === "failed")
        ? {
            provider: asset.cloudProvider,
            status: asset.cloudStatus,
            lastError: asset.cloudError ?? undefined,
            uploadedAt: asset.cloudUploadedAt ?? undefined
          }
        : undefined
  };
}

function resolveGenerationStatus(successCount: number, failureCount: number): GenerationStatus {
  if (successCount > 0 && failureCount > 0) {
    return "partial";
  }
  if (successCount > 0) {
    return "succeeded";
  }
  return "failed";
}

function toGenerationOutput(output: BatchOutputResult): GenerationOutput {
  return {
    id: output.id,
    status: output.status,
    asset: output.asset,
    error: output.error
  };
}

async function saveAssetToConfiguredCloud(input: {
  fileName: string;
  bytes: Buffer;
  mimeType: string;
  createdAt: string;
}, hostContext?: HostContext): Promise<AssetCloudStorageRecord | undefined> {
  const active = getActiveCloudStorageConfig(hostContext);
  if (!active) {
    return undefined;
  }

  const objectKey = buildCloudObjectKey(active.config.keyPrefix, input.fileName, input.createdAt);

  try {
    const result =
      active.provider === "cos"
        ? await new CosAssetStorageAdapter(active.config).putObject({
            key: objectKey,
            bytes: input.bytes,
            mimeType: input.mimeType
          })
        : await new S3CompatibleAssetStorageAdapter(active.config).putObject({
            key: objectKey,
            bytes: input.bytes,
            mimeType: input.mimeType
          });

    return {
      provider: active.provider,
      bucket: active.config.bucket,
      region: active.config.region,
      objectKey,
      status: "uploaded",
      endpoint: active.provider === "s3" ? active.config.endpoint : undefined,
      forcePathStyle: active.provider === "s3" ? active.config.forcePathStyle : undefined,
      uploadedAt: new Date().toISOString(),
      etag: result.etag,
      requestId: result.requestId
    };
  } catch (error) {
    return {
      provider: active.provider,
      bucket: active.config.bucket,
      region: active.config.region,
      objectKey,
      status: "failed",
      endpoint: active.provider === "s3" ? active.config.endpoint : undefined,
      forcePathStyle: active.provider === "s3" ? active.config.forcePathStyle : undefined,
      error: storageErrorMessage(error)
    };
  }
}

async function readCloudAsset(location: StoredCloudAssetLocation | undefined, hostContext?: HostContext): Promise<Buffer | undefined> {
  const active = getActiveCloudStorageConfig(hostContext);
  if (!location || !active || location.provider !== active.provider) {
    return undefined;
  }

  try {
    if (active.provider === "cos" && location.provider === "cos") {
      return await new CosAssetStorageAdapter(active.config).getObject(location);
    }

    if (active.provider !== "s3" || location.provider !== "s3") {
      return undefined;
    }

    return await new S3CompatibleAssetStorageAdapter({
      ...active.config,
      bucket: location.bucket,
      region: location.region,
      endpoint: location.endpoint,
      forcePathStyle: location.forcePathStyle
    }).getObject(location);
  } catch {
    return undefined;
  }
}

function toCloudAssetLocation(asset: typeof assets.$inferSelect): StoredCloudAssetLocation | undefined {
  if (
    (asset.cloudProvider !== "cos" && asset.cloudProvider !== "s3") ||
    asset.cloudStatus !== "uploaded" ||
    !asset.cloudBucket ||
    !asset.cloudRegion ||
    !asset.cloudObjectKey
  ) {
    return undefined;
  }

  if (asset.cloudProvider === "cos") {
    return {
      provider: "cos",
      bucket: asset.cloudBucket,
      region: asset.cloudRegion,
      key: asset.cloudObjectKey
    };
  }

  if (!asset.cloudEndpoint) {
    return undefined;
  }

  return {
    provider: "s3",
    bucket: asset.cloudBucket,
    region: asset.cloudRegion,
    key: asset.cloudObjectKey,
    endpoint: asset.cloudEndpoint,
    forcePathStyle: asset.cloudForcePathStyle === 1
  };
}

function toGeneratedAssetCloud(cloudStorage: AssetCloudStorageRecord | undefined): GeneratedAssetCloudInfo | undefined {
  if (!cloudStorage) {
    return undefined;
  }

  return {
    provider: cloudStorage.provider,
    status: cloudStorage.status,
    lastError: cloudStorage.error,
    uploadedAt: cloudStorage.uploadedAt
  };
}

function hostUserId(hostContext: HostContext | undefined): string {
  return hostContext?.user.id ?? "standalone";
}

function newGenerationStorageId(hostContext: HostContext | undefined): string {
  return hostUserId(hostContext) === "standalone" ? randomUUID() : `g.${randomUUID()}`;
}

async function mapWithConcurrency<T, TResult>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<TResult>
): Promise<TResult[]> {
  const results = new Array<TResult>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function generationFailureMessage(error: unknown): string {
  if (error instanceof ProviderError) {
    return providerFailureMessage(error);
  }
  return "图像生成执行失败（内部错误）。请重试；如持续发生，请联系管理员。";
}

function providerFailureMessage(error: ProviderError): string {
  switch (error.code) {
    case "missing_api_key":
      return "图像生成源缺少 API Key，请先配置后重试。";
    case "missing_provider":
      return "没有可用的图像生成源，请先配置图片模型或登录 Codex。";
    case "unsupported_provider_behavior":
      return error.status === 400
        ? "图像请求或参考图不受支持，请检查输入后重试。"
        : "图像生成服务返回了不受支持的响应，请稍后重试。";
    case "upstream_failure":
      if (error.status === 400 || error.status === 422) {
        return `图像生成服务拒绝了当前请求（HTTP ${error.status}）。请检查提示词、尺寸、格式或模型参数后重试。`;
      }
      if (error.status === 401) {
        return "图像生成服务认证失败（HTTP 401）。请检查当前生成源的 API Key。";
      }
      if (error.status === 403) {
        return "图像生成服务拒绝访问（HTTP 403）。请检查额度、分组图片权限或模型可用性。";
      }
      if (error.status === 408 || error.status === 504 || error.status === 524) {
        return `图像生成服务请求超时（HTTP ${error.status}）。请稍后重试或降低分辨率。`;
      }
      if (error.status === 409 || error.status === 429) {
        return `图像生成服务暂时无法处理请求（HTTP ${error.status}）。请稍后重试并检查额度或并发限制。`;
      }
      return `图像生成服务请求失败（HTTP ${error.status}）。请稍后重试。`;
    default:
      return assertNever(error.code);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected provider error code: ${String(value)}`);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function isInsideDirectory(filePath: string, directory: string): boolean {
  const localPath = relative(directory, filePath);
  return Boolean(localPath) && !localPath.startsWith("..") && !isAbsolute(localPath);
}

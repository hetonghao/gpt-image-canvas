import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  GeneratedAsset,
  GalleryImageItem,
  GalleryResponse,
  GenerationRecord as ApiGenerationRecord,
  ImageMode,
  ImageQuality,
  OutputFormat,
  ProjectState
} from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import { assets, generationOutputs, generationRecords, projects } from "../../infrastructure/schema.js";
import type { HostContext } from "../host/host-adapter.js";
import { listGenerationRecords } from "../generation/image-generation.js";

export const DEFAULT_PROJECT_ID = "default";
const DEFAULT_PROJECT_NAME = "Default Project";
const LARGE_PROJECT_SNAPSHOT_WARNING_BYTES = 1024 * 1024;
const fallbackWarnings = new Set<string>();

interface ProjectSnapshotInput {
  name?: string;
  snapshotJson: string;
}

interface ProjectSaveResult {
  id: string;
  ok: true;
  updatedAt: string;
}

export interface GalleryExportAsset {
  outputId: string;
  assetId: string;
  fileName: string;
  mimeType: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseSnapshot(snapshotJson: string): unknown | null {
  return JSON.parse(snapshotJson) as unknown;
}

function cleanSnapshotJson(snapshotJson: string): string {
  const snapshot = parseSnapshot(snapshotJson);
  const cleanedSnapshot = removeUnreferencedAssetsFromSnapshot(snapshot);
  return cleanedSnapshot === snapshot ? snapshotJson : JSON.stringify(cleanedSnapshot);
}

function removeUnreferencedAssetsFromSnapshot<TSnapshot>(snapshot: TSnapshot): TSnapshot {
  if (!isRecord(snapshot)) {
    return snapshot;
  }

  if (isRecord(snapshot.document)) {
    const document = removeUnreferencedAssetsFromStoreSnapshot(snapshot.document);
    return document === snapshot.document ? snapshot : ({ ...snapshot, document } as TSnapshot);
  }

  return removeUnreferencedAssetsFromStoreSnapshot(snapshot);
}

function removeUnreferencedAssetsFromStoreSnapshot<TSnapshot>(snapshot: TSnapshot): TSnapshot {
  if (!isRecord(snapshot) || !isRecord(snapshot.store)) {
    return snapshot;
  }

  const assetIds = new Set(
    Object.entries(snapshot.store)
      .filter(([id, record]) => isAssetSnapshotRecord(id, record))
      .map(([id]) => id)
  );
  if (assetIds.size === 0) {
    return snapshot;
  }

  const referencedAssetIds = new Set<string>();
  for (const [id, record] of Object.entries(snapshot.store)) {
    if (!isAssetSnapshotRecord(id, record)) {
      collectAssetReferences(record, assetIds, referencedAssetIds);
    }
  }

  let changed = false;
  const store: Record<string, unknown> = {};
  for (const [id, record] of Object.entries(snapshot.store)) {
    if (isAssetSnapshotRecord(id, record) && !referencedAssetIds.has(id)) {
      changed = true;
      continue;
    }

    store[id] = record;
  }

  return changed ? ({ ...snapshot, store } as TSnapshot) : snapshot;
}

function collectAssetReferences(value: unknown, assetIds: Set<string>, referencedAssetIds: Set<string>): void {
  if (typeof value === "string") {
    if (assetIds.has(value)) {
      referencedAssetIds.add(value);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const child of Object.values(value)) {
    collectAssetReferences(child, assetIds, referencedAssetIds);
  }
}

function isAssetSnapshotRecord(id: string, value: unknown): boolean {
  return isRecord(value) && (value.typeName === "asset" || id.startsWith("asset:"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function ensureDefaultProject(hostContext?: HostContext): void {
  const existing = getDefaultProjectRow(hostContext);

  if (existing) {
    return;
  }

  const createdAt = nowIso();
  db.insert(projects)
    .values({
      id: scopedSingletonId(DEFAULT_PROJECT_ID, hostContext),
      userId: hostUserId(hostContext),
      name: DEFAULT_PROJECT_NAME,
      snapshotJson: "null",
      createdAt,
      updatedAt: createdAt
    })
    .onConflictDoNothing()
    .run();
}

export function saveProjectSnapshot(input: ProjectSnapshotInput, hostContext?: HostContext): ProjectSaveResult {
  ensureDefaultProject(hostContext);

  const updatedAt = nowIso();
  const current = getDefaultProjectRow(hostContext);
  const projectId = scopedSingletonId(DEFAULT_PROJECT_ID, hostContext);
  const snapshotJson = cleanSnapshotJson(input.snapshotJson);

  db.update(projects)
    .set({
      name: input.name ?? current?.name ?? DEFAULT_PROJECT_NAME,
      snapshotJson,
      updatedAt
    })
    .where(and(eq(projects.id, projectId), eq(projects.userId, hostUserId(hostContext))))
    .run();

  return {
    id: projectId,
    ok: true,
    updatedAt
  };
}

export function getProjectState(hostContext?: HostContext): ProjectState {
  ensureDefaultProject(hostContext);

  const project = getDefaultProjectRow(hostContext);

  if (!project) {
    return {
      id: scopedSingletonId(DEFAULT_PROJECT_ID, hostContext),
      name: DEFAULT_PROJECT_NAME,
      snapshot: null,
      history: getGenerationHistory(hostContext),
      updatedAt: nowIso()
    };
  }

  const snapshotBytes = Buffer.byteLength(project.snapshotJson, "utf8");
  if (snapshotBytes > LARGE_PROJECT_SNAPSHOT_WARNING_BYTES) {
    warnOnce(
      `project-snapshot-large:${project.userId}`,
      `Project snapshot for user ${project.userId} is large (${snapshotBytes} bytes); project load may be slow.`
    );
  }

  return {
    id: project.id,
    name: project.name,
    snapshot: removeUnreferencedAssetsFromSnapshot(parseSnapshot(project.snapshotJson)),
    history: getGenerationHistory(hostContext),
    updatedAt: project.updatedAt
  };
}

export function getGalleryImages(hostContext?: HostContext): GalleryResponse {
  const rows = db
    .select({
      output: generationOutputs,
      generation: generationRecords,
      asset: assets
    })
    .from(generationOutputs)
    .innerJoin(generationRecords, eq(generationOutputs.generationId, generationRecords.id))
    .innerJoin(assets, eq(generationOutputs.assetId, assets.id))
    .where(and(eq(generationOutputs.status, "succeeded"), eq(generationRecords.userId, hostUserId(hostContext)), eq(assets.userId, hostUserId(hostContext))))
    .orderBy(desc(generationOutputs.createdAt))
    .all();

  return {
    items: rows.map(({ output, generation, asset }) => ({
      outputId: output.id,
      generationId: generation.id,
      mode: generation.mode as ImageMode,
      prompt: generation.prompt,
      effectivePrompt: generation.effectivePrompt,
      presetId: generation.presetId,
      size: {
        width: generation.width,
        height: generation.height
      },
      quality: generation.quality as ImageQuality,
      outputFormat: generation.outputFormat as OutputFormat,
      createdAt: output.createdAt,
      asset: toGeneratedAsset(asset)
    })).filter((item): item is GalleryImageItem => Boolean(item.asset))
  };
}

export function deleteGalleryOutput(outputId: string, hostContext?: HostContext): boolean {
  const owned = db
    .select({ id: generationOutputs.id })
    .from(generationOutputs)
    .innerJoin(generationRecords, eq(generationOutputs.generationId, generationRecords.id))
    .where(and(eq(generationOutputs.id, outputId), eq(generationRecords.userId, hostUserId(hostContext))))
    .get();
  if (!owned) {
    return false;
  }

  const result = db.delete(generationOutputs).where(eq(generationOutputs.id, outputId)).run();
  return result.changes > 0;
}

export function getGalleryExportAssets(outputIds: string[], hostContext?: HostContext): GalleryExportAsset[] {
  if (outputIds.length === 0) {
    return [];
  }

  const rows = db
    .select({
      outputId: generationOutputs.id,
      assetId: assets.id,
      fileName: assets.fileName,
      mimeType: assets.mimeType
    })
    .from(generationOutputs)
    .innerJoin(generationRecords, eq(generationOutputs.generationId, generationRecords.id))
    .innerJoin(assets, eq(generationOutputs.assetId, assets.id))
    .where(
      and(
        inArray(generationOutputs.id, outputIds),
        eq(generationOutputs.status, "succeeded"),
        eq(generationRecords.userId, hostUserId(hostContext)),
        eq(assets.userId, hostUserId(hostContext))
      )
    )
    .all();

  const rowByOutputId = new Map(rows.map((row) => [row.outputId, row]));
  return outputIds.flatMap((outputId) => {
    const row = rowByOutputId.get(outputId);
    return row ? [row] : [];
  });
}

function getDefaultProjectRow(hostContext?: HostContext): (typeof projects.$inferSelect) | undefined {
  try {
    return db
      .select()
      .from(projects)
      .where(and(eq(projects.id, scopedSingletonId(DEFAULT_PROJECT_ID, hostContext)), eq(projects.userId, hostUserId(hostContext))))
      .get();
  } catch (error) {
    warnOnce(
      "project-read-fallback",
      `Project row could not be read; returning a blank canvas fallback. ${formatErrorSummary(error)}`
    );
    return undefined;
  }
}

function getGenerationHistory(hostContext?: HostContext): ApiGenerationRecord[] {
  try {
    return listGenerationRecords(hostContext);
  } catch (error) {
    warnOnce(
      "history-read-fallback",
      `Generation history could not be read; returning an empty history. ${formatErrorSummary(error)}`
    );
    return [];
  }
}

function warnOnce(key: string, message: string): void {
  if (fallbackWarnings.has(key)) {
    return;
  }

  fallbackWarnings.add(key);
  console.warn(message);
}

function formatErrorSummary(error: unknown): string {
  if (error instanceof Error) {
    const codeValue = (error as { code?: unknown }).code;
    const code = typeof codeValue === "string" ? `${codeValue}: ` : "";
    return `${code}${error.message}`;
  }

  return String(error);
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

function hostUserId(hostContext: HostContext | undefined): string {
  return hostContext?.user.id ?? "standalone";
}

function scopedSingletonId(id: string, hostContext: HostContext | undefined): string {
  const userId = hostUserId(hostContext);
  return userId === "standalone" ? id : `${userId}:${id}`;
}

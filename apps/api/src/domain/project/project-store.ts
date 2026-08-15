import { and, desc, eq, inArray } from "drizzle-orm";
import {
  validateExcalidrawProjectSnapshot,
  type CanvasAssetReference,
  type GeneratedAsset,
  type GalleryImageItem,
  type GalleryResponse,
  type GenerationRecord as ApiGenerationRecord,
  type ImageMode,
  type ImageQuality,
  type OutputFormat,
  type ProjectState
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
  try {
    return JSON.parse(snapshotJson);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ProjectSnapshotFormatError("Persisted project snapshot is not valid JSON.");
    }
    throw error;
  }
}

export class ProjectSnapshotFormatError extends Error {
  readonly code = "project_snapshot_invalid";
}

export class ProjectSnapshotAssetError extends Error {
  constructor(
    readonly code: "project_asset_missing" | "project_asset_mismatch",
    message: string
  ) {
    super(message);
  }
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
  const snapshot = parseSnapshot(input.snapshotJson);
  const validatedSnapshot = validateExcalidrawProjectSnapshot(snapshot);
  if (!validatedSnapshot.ok) {
    throw new Error(validatedSnapshot.reason);
  }
  validateProjectAssetReferences(validatedSnapshot.value?.assets ?? {}, hostContext);
  const snapshotJson = JSON.stringify(validatedSnapshot.value);

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

  const validatedSnapshot = validateExcalidrawProjectSnapshot(parseSnapshot(project.snapshotJson));
  if (!validatedSnapshot.ok) {
    throw new ProjectSnapshotFormatError("Persisted project snapshot is not a valid AI Cove Excalidraw scene.");
  }

  return {
    id: project.id,
    name: project.name,
    snapshot: validatedSnapshot.value,
    history: getGenerationHistory(hostContext),
    updatedAt: project.updatedAt
  };
}

function validateProjectAssetReferences(
  references: Record<string, CanvasAssetReference>,
  hostContext?: HostContext
): void {
  for (const reference of Object.values(references)) {
    const asset = db
      .select()
      .from(assets)
      .where(and(eq(assets.id, reference.assetId), eq(assets.userId, hostUserId(hostContext))))
      .get();
    if (!asset) {
      throw new ProjectSnapshotAssetError("project_asset_missing", "A referenced project asset does not exist.");
    }
    if (
      asset.fileName !== reference.fileName ||
      asset.mimeType !== reference.mimeType ||
      asset.width !== reference.width ||
      asset.height !== reference.height ||
      asset.byteSize !== reference.byteSize ||
      asset.contentSha256 !== reference.contentSha256
    ) {
      throw new ProjectSnapshotAssetError("project_asset_mismatch", "A referenced project asset failed integrity validation.");
    }
  }
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

function hostUserId(hostContext: HostContext | undefined): string {
  return hostContext?.user.id ?? "standalone";
}

function scopedSingletonId(id: string, hostContext: HostContext | undefined): string {
  const userId = hostUserId(hostContext);
  return userId === "standalone" ? id : `${userId}:${id}`;
}

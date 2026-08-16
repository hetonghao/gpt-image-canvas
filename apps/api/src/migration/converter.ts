import { Buffer } from "node:buffer";
import { assetIdCandidates, verifyAsset, verifyEmbeddedAsset } from "./assets.js";
import { assetReference, boxElement, businessData, hashString, imageElement, lineElement, pointsFromProps, textElement, textFromProps } from "./elements.js";
import { isRecord, numberValue, recordValue, stringValue } from "./json.js";
import type { SourceShape } from "./source-types.js";
import { preserveTargetProject } from "./target-project.js";
import type {
  AssetRow,
  BlockedProject,
  ConversionOutcome,
  ConvertedProject,
  JsonRecord,
  ProjectRow,
  VerifiedAsset,
  WarningCode
} from "./types.js";

const MAX_PROJECT_SNAPSHOT_BYTES = 100 * 1024 * 1024;
const KNOWN_SYSTEM_RECORDS = new Set([
  "document",
  "page",
  "camera",
  "instance",
  "instance_page_state",
  "pointer",
  "instance_presence",
  "session"
]);

type TargetElement = JsonRecord;

export async function convertProject(
  inputDir: string,
  project: ProjectRow,
  assets: ReadonlyMap<string, AssetRow>
): Promise<ConversionOutcome> {
  const parsed = parseJson(project.snapshotJson);
  if (parsed === undefined) return blocked(project, 0, "invalid_snapshot");
  if (parsed === null) {
    return converted(project, 0, [], {}, [], []);
  }
  if (!isRecord(parsed)) return blocked(project, 0, "invalid_snapshot");
  const preserved = await preserveTargetProject({ inputDir, project, parsed, assets });
  if (preserved) return preserved;

  const store = extractStore(parsed);
  if (store.kind === "blocked") return blocked(project, 0, store.code);
  const rawRecords = Object.values(store.value);
  if (rawRecords.some((record) => !isRecord(record))) return blocked(project, 0, "invalid_snapshot");
  const records = rawRecords.filter((record): record is JsonRecord => isRecord(record));
  const pages = records.filter((record) => recordType(record) === "page");
  if (pages.length > 1) return blocked(project, countShapes(records), "unsupported_page_model");

  const sourceShapes: SourceShape[] = [];
  const sourceAssets = new Map<string, JsonRecord>();
  const failures = new Set<BlockedProject["failures"][number]>();
  const warnings = new Set<WarningCode>();
  for (const record of records) {
    const typeName = recordType(record);
    if (typeName === "shape") {
      const shape = parseShape(record);
      if (shape) sourceShapes.push(shape);
      else failures.add("geometry_invalid");
      continue;
    }
    if (typeName === "asset") {
      const id = stringValue(record.id);
      if (id) sourceAssets.set(id, record);
      continue;
    }
    if (typeName === "binding") {
      failures.add("binding_or_parent_loss");
      continue;
    }
    if (typeName && KNOWN_SYSTEM_RECORDS.has(typeName)) continue;
    failures.add("invalid_snapshot");
  }
  if (failures.size > 0) return blocked(project, sourceShapes.length, ...failures);

  const verifiedAssets = new Map<string, VerifiedAsset>();
  const fileIds = new Map<string, string>();
  const assetRefs: Record<string, JsonRecord> = {};
  const elements: TargetElement[] = [];
  const assetVerification = new Map<string, Promise<Awaited<ReturnType<typeof verifyAsset>>>>();
  for (const shape of sourceShapes.sort(compareShapes)) {
    const converted = await convertShape(inputDir, project, shape, sourceAssets, assets, verifiedAssets, fileIds, assetRefs, assetVerification);
    if (converted.kind === "blocked") return blocked(project, sourceShapes.length, converted.code);
    elements.push(...converted.elements);
    converted.warnings.forEach((warning) => warnings.add(warning));
  }
  if (sourceShapes.length === 0 && Object.keys(store.value).length > 0 && hasSessionState(parsed)) warnings.add("session_state_reset");
  const snapshot = {
    format: "ai-cove-excalidraw",
    version: 1,
    scene: { elements, appState: {} },
    assets: assetRefs
  } satisfies JsonRecord;
  const snapshotJson = JSON.stringify(snapshot);
  if (Buffer.byteLength(snapshotJson, "utf8") > MAX_PROJECT_SNAPSHOT_BYTES) return blocked(project, sourceShapes.length, "snapshot_too_large");
  return converted(project, sourceShapes.length, elements, assetRefs, [...verifiedAssets.values()], [...warnings], snapshotJson);
}

async function convertShape(
  inputDir: string,
  project: ProjectRow,
  shape: SourceShape,
  sourceAssets: ReadonlyMap<string, JsonRecord>,
  assets: ReadonlyMap<string, AssetRow>,
  verifiedAssets: Map<string, VerifiedAsset>,
  fileIds: Map<string, string>,
  assetRefs: Record<string, JsonRecord>,
  assetVerification: Map<string, Promise<Awaited<ReturnType<typeof verifyAsset>>>>
): Promise<{ readonly kind: "converted"; readonly elements: readonly TargetElement[]; readonly warnings: readonly WarningCode[] } | { readonly kind: "blocked"; readonly code: "asset_missing" | "asset_materialization_failed" | "geometry_invalid" | "unknown_shape" }> {
  if (requiresDimensions(shape.type) && (!positiveDimension(shape.props.w) || !positiveDimension(shape.props.h))) {
    return { kind: "blocked", code: "geometry_invalid" };
  }
  const business = businessData(shape);
  switch (shape.type) {
    case "image": {
      const assetRecord = sourceAssets.get(`asset:${stringValue(shape.props.assetId)?.replace(/^asset:/u, "") ?? ""}`) ?? sourceAssets.get(stringValue(shape.props.assetId) ?? "");
      const candidates = assetIdCandidates(shape.props, assetRecord);
      const assetId = candidates.find((candidate) => assets.has(candidate)) ?? candidates[0];
      if (!assetId) return { kind: "blocked", code: "asset_missing" };
      let verification = assetVerification.get(assetId);
      if (!verification) {
        const asset = assets.get(assetId);
        verification = asset ? verifyAsset(inputDir, project.userId, asset) : verifyEmbeddedAsset(project.userId, assetId, assetRecord);
        assetVerification.set(assetId, verification);
      }
      const result = await verification;
      if (result.kind === "blocked") return result;
      verifiedAssets.set(assetId, result.value);
      const fileId = fileIds.get(assetId) ?? `file-${hashString(`${project.id}:${assetId}`).slice(0, 32)}`;
      fileIds.set(assetId, fileId);
      assetRefs[fileId] = assetReference(result.value);
      return { kind: "converted", elements: [imageElement(shape, fileId, business)], warnings: [] };
    }
    case "text": {
      const text = textFromProps(shape.props);
      if (text === undefined) return { kind: "blocked", code: "unknown_shape" };
      return { kind: "converted", elements: [textElement(shape, text, business)], warnings: [] };
    }
    case "geo": {
      const geo = stringValue(shape.props.geo);
      if (geo === "rectangle" || geo === "ellipse" || geo === "diamond") {
        return { kind: "converted", elements: [boxElement(shape, geo, business)], warnings: [] };
      }
      return degraded(shape, business, `迁移近似：${geo ?? "geo"}`);
    }
    case "line":
    case "arrow":
    case "draw": {
      const points = pointsFromProps(shape.props);
      if (points.length < 2) return { kind: "blocked", code: "geometry_invalid" };
      const type = shape.type === "draw" ? "freedraw" : shape.type;
      return { kind: "converted", elements: [lineElement(shape, type, points, business)], warnings: [] };
    }
    case "frame": return { kind: "converted", elements: [boxElement(shape, "frame", business)], warnings: [] };
    case "note":
    case "bookmark":
    case "embed":
    case "video":
    case "highlight":
    case "generation-placeholder":
    case "agent-plan-node":
    case "reference-region":
    case "region-reference":
      return degraded(shape, business, `迁移占位：${shape.type}`);
    default:
      return { kind: "blocked", code: "unknown_shape" };
  }
}

function degraded(shape: SourceShape, business: JsonRecord, label: string): { readonly kind: "converted"; readonly elements: readonly TargetElement[]; readonly warnings: readonly WarningCode[] } {
  const box = boxElement(shape, "rectangle", business);
  const text = textElement(shape, label, business, "label");
  return { kind: "converted", elements: [box, text], warnings: ["visual_degraded"] };
}

function parseJson(value: string): unknown | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function extractStore(value: JsonRecord): { readonly kind: "store"; readonly value: JsonRecord } | { readonly kind: "empty"; readonly value: JsonRecord } | { readonly kind: "blocked"; readonly code: "invalid_snapshot" } {
  const document = recordValue(value.document);
  const store = recordValue(document?.store) ?? recordValue(value.store);
  if (!store) return { kind: "blocked", code: "invalid_snapshot" };
  return { kind: "store", value: store };
}

function parseShape(value: JsonRecord): SourceShape | undefined {
  const id = stringValue(value.id);
  const type = stringValue(value.type);
  const x = numberValue(value.x);
  const y = numberValue(value.y);
  const props = recordValue(value.props);
  if (!id || !type || x === undefined || y === undefined || !props) return undefined;
  return { id, type, x, y, rotation: numberValue(value.rotation) ?? 0, index: stringValue(value.index) ?? id, props };
}

function countShapes(records: readonly unknown[]): number {
  return records.filter((record) => isRecord(record) && recordType(record) === "shape").length;
}

function recordType(record: unknown): string | undefined {
  return isRecord(record) ? stringValue(record.typeName) : undefined;
}

function compareShapes(left: SourceShape, right: SourceShape): number {
  return left.index.localeCompare(right.index) || left.id.localeCompare(right.id);
}

function converted(project: ProjectRow, sourceShapeCount: number, elements: readonly TargetElement[], assets: Record<string, JsonRecord>, verifiedAssets: readonly VerifiedAsset[], warnings: readonly WarningCode[] = [], snapshotJson?: string): ConversionOutcome {
  const snapshot = snapshotJson ?? JSON.stringify({ format: "ai-cove-excalidraw", version: 1, scene: { elements, appState: {} }, assets });
  const value: ConvertedProject = { id: project.id, userId: project.userId, snapshotJson: snapshot, sourceShapeCount, targetElementCount: elements.length, assetReferences: Object.keys(assets).length, verifiedAssets, warnings };
  return { kind: "converted", value };
}

function blocked(project: ProjectRow, sourceShapeCount: number, ...failures: BlockedProject["failures"]): ConversionOutcome {
  return { kind: "blocked", value: { id: project.id, userId: project.userId, sourceShapeCount, targetElementCount: 0, assetReferences: 0, verifiedAssets: [], warnings: [], failures } };
}

function hasSessionState(value: JsonRecord): boolean {
  const session = recordValue(value.session);
  return Boolean(session && Object.keys(session).length > 0);
}

function requiresDimensions(type: string): boolean {
  return type !== "line" && type !== "arrow" && type !== "draw";
}

function positiveDimension(value: unknown): boolean {
  const parsed = numberValue(value);
  return parsed !== undefined && parsed > 0;
}

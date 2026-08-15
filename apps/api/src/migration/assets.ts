import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve, relative } from "node:path";
import sharp from "sharp";
import type Database from "better-sqlite3";
import { isRecord, numberValue, stringValue } from "./json.js";
import type { AssetRow, AssetVerificationOutcome, JsonRecord, VerifiedAsset } from "./types.js";

export function readAssetRows(database: Database.Database): readonly AssetRow[] {
  const columns = new Set(assetTableColumns(database));
  const integrityColumns = ["byte_size", "content_sha256"].filter((column) => columns.has(column));
  const rows = database.prepare(
    `SELECT id, user_id, file_name, relative_path, mime_type, width, height, ${integrityColumns.join(", ") || "NULL AS byte_size, NULL AS content_sha256"} FROM assets`
  ).all();
  if (!Array.isArray(rows)) {
    throw new Error("assets query did not return rows");
  }
  return rows.map(parseAssetRow);
}

export async function verifyAsset(inputDir: string, projectUserId: string, asset: AssetRow): Promise<AssetVerificationOutcome> {
  if (asset.userId !== projectUserId) {
    return { kind: "blocked", code: "asset_missing" };
  }
  const path = assetPath(inputDir, asset);
  if (!path || !existsSync(path)) {
    return { kind: "blocked", code: "asset_missing" };
  }

  try {
    const bytes = readFileSync(path);
    return verifyAssetBytes(projectUserId, asset, bytes);
  } catch (error) {
    if (error instanceof Error) {
      return { kind: "blocked", code: "asset_materialization_failed" };
    }
    throw error;
  }
}

export async function verifyAssetBytes(projectUserId: string, asset: AssetRow, bytes: Uint8Array): Promise<AssetVerificationOutcome> {
  if (asset.userId !== projectUserId) return { kind: "blocked", code: "asset_missing" };
  try {
    const digest = createHash("sha256").update(bytes).digest("hex");
    const metadata = await sharp(bytes).metadata();
    const mimeType = normalizeMime(asset.mimeType);
    const actualMimeType = mimeForFormat(metadata.format);
    if (
      !mimeType ||
      !actualMimeType ||
      mimeType !== actualMimeType ||
      !metadata.width ||
      !metadata.height ||
      metadata.width !== asset.width ||
      metadata.height !== asset.height ||
      (asset.byteSize !== null && asset.byteSize !== bytes.byteLength) ||
      (asset.contentSha256 !== null && asset.contentSha256 !== digest)
    ) return { kind: "blocked", code: "asset_materialization_failed" };
    return { kind: "verified", value: { ...asset, mimeType, actualByteSize: bytes.byteLength, actualContentSha256: digest, actualWidth: metadata.width, actualHeight: metadata.height } };
  } catch (error) {
    if (error instanceof Error) return { kind: "blocked", code: "asset_materialization_failed" };
    throw error;
  }
}

export function assetPath(inputDir: string, asset: AssetRow): string | undefined {
  const assetRoot = resolve(inputDir, "assets");
  const path = resolve(inputDir, asset.relativePath);
  return isAbsolute(asset.relativePath) || !isWithin(assetRoot, path) ? undefined : path;
}

export function assetIdCandidates(shapeProps: JsonRecord, assetRecord: JsonRecord | undefined): readonly string[] {
  const candidates = [
    stringValue(assetRecord?.meta && isRecord(assetRecord.meta) ? assetRecord.meta.localAssetId : undefined),
    stringValue(shapeProps.assetId),
    stringValue(shapeProps.localAssetId)
  ];
  return candidates.flatMap((candidate) => {
    if (!candidate) return [];
    if (candidate.startsWith("asset:")) return [candidate.slice("asset:".length)];
    return [candidate];
  });
}

function parseAssetRow(value: unknown): AssetRow {
  if (!isRecord(value)) throw new Error("asset row is not an object");
  const id = stringValue(value.id);
  const userId = stringValue(value.user_id);
  const fileName = stringValue(value.file_name);
  const relativePath = stringValue(value.relative_path);
  const mimeType = stringValue(value.mime_type);
  const width = numberValue(value.width);
  const height = numberValue(value.height);
  let byteSize: number | null;
  if (value.byte_size === undefined || value.byte_size === null) {
    byteSize = null;
  } else {
    const parsed = numberValue(value.byte_size);
    if (parsed === undefined) throw new Error("asset row byte size is invalid");
    byteSize = parsed;
  }
  let contentSha256: string | null;
  if (value.content_sha256 === undefined || value.content_sha256 === null) {
    contentSha256 = null;
  } else {
    const parsed = stringValue(value.content_sha256);
    if (parsed === undefined) throw new Error("asset row content hash is invalid");
    contentSha256 = parsed;
  }
  if (!id || !userId || !fileName || !relativePath || !mimeType || width === undefined || height === undefined) {
    throw new Error("asset row is invalid");
  }
  return { id, userId, fileName, relativePath, mimeType, width, height, byteSize, contentSha256 };
}

function assetTableColumns(database: Database.Database): readonly string[] {
  const rows = database.prepare("PRAGMA table_info(assets)").all();
  if (!Array.isArray(rows)) throw new Error("assets table info did not return rows");
  return rows.flatMap((row) => {
    if (!isRecord(row)) return [];
    const name = stringValue(row.name);
    return name ? [name] : [];
  });
}

function normalizeMime(value: string): "image/png" | "image/jpeg" | "image/webp" | undefined {
  switch (value.toLowerCase()) {
    case "image/png": return "image/png";
    case "image/jpeg":
    case "image/jpg": return "image/jpeg";
    case "image/webp": return "image/webp";
    default: return undefined;
  }
}

function mimeForFormat(value: string | undefined): "image/png" | "image/jpeg" | "image/webp" | undefined {
  switch (value) {
    case "png": return "image/png";
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    default: return undefined;
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

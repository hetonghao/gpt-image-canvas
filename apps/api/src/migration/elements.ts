import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { arrayValue, isRecord, numberValue, recordValue, stringValue } from "./json.js";
import type { SourceShape } from "./source-types.js";
import type { JsonRecord, VerifiedAsset } from "./types.js";

export type TargetElement = JsonRecord;

export function businessData(shape: SourceShape): JsonRecord {
  return {
    "ai-cove": {
      kind: shape.type,
      schemaVersion: 1,
      sourceShapeHash: hashString(shape.id),
      ...(shape.pageId ? { sourcePageId: shape.pageId } : {}),
      ...(shape.pageName ? { sourcePageName: shape.pageName } : {})
    }
  };
}

export function imageElement(shape: SourceShape, fileId: string, customData: JsonRecord): TargetElement {
  return {
    id: elementId(shape.id), type: "image", x: shape.x, y: shape.y,
    width: dimension(shape.props.w), height: dimension(shape.props.h), angle: shape.rotation,
    fileId, status: "saved", scale: [shape.props.flipX === true ? -1 : 1, shape.props.flipY === true ? -1 : 1], customData
  };
}

export function boxElement(shape: SourceShape, type: string, customData: JsonRecord): TargetElement {
  return { id: elementId(shape.id), type, x: shape.x, y: shape.y, width: dimension(shape.props.w), height: dimension(shape.props.h), angle: shape.rotation, customData };
}

export function textElement(shape: SourceShape, text: string, customData: JsonRecord, suffix = "text"): TargetElement {
  return { id: `${elementId(shape.id)}-${suffix}`, type: "text", x: shape.x, y: shape.y, width: dimension(shape.props.w), height: dimension(shape.props.h), angle: shape.rotation, text, fontSize: 20, customData };
}

export function lineElement(shape: SourceShape, type: string, points: readonly [number, number][], customData: JsonRecord): TargetElement {
  return { id: elementId(shape.id), type, x: shape.x, y: shape.y, width: dimension(shape.props.w, 1), height: dimension(shape.props.h, 1), angle: shape.rotation, points, customData };
}

export function pointsFromProps(props: JsonRecord): readonly [number, number][] {
  const points = arrayValue(props.points);
  if (points) return points.flatMap((point): [number, number][] => {
    if (Array.isArray(point)) {
      const x = numberValue(point[0]);
      const y = numberValue(point[1]);
      return x !== undefined && y !== undefined ? [[x, y]] : [];
    }
    if (isRecord(point)) {
      const x = numberValue(point.x);
      const y = numberValue(point.y);
      return x !== undefined && y !== undefined ? [[x, y]] : [];
    }
    return [];
  });
  const segments = arrayValue(props.segments);
  if (!segments) return [];
  const scaleX = numberValue(props.scaleX) ?? 1;
  const scaleY = numberValue(props.scaleY) ?? 1;
  return segments.flatMap((segment) => {
    const record = recordValue(segment);
    const path = stringValue(record?.path);
    if (!path) return [];
    const dimension = numberValue(record?.dim) === 2 ? 2 : 3;
    return decodeCompressedPath(path, dimension).map(([x, y]) => [x * scaleX, y * scaleY] as [number, number]);
  });
}

function decodeCompressedPath(path: string, dimension: 2 | 3): readonly [number, number][] {
  const bytes = Buffer.from(path, "base64");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstBytes = dimension === 2 ? 8 : 12;
  const deltaBytes = dimension === 2 ? 4 : 6;
  if (bytes.byteLength < firstBytes) return [];
  let x = view.getFloat32(0, true);
  let y = view.getFloat32(4, true);
  const points: [number, number][] = [[x, y]];
  for (let offset = firstBytes; offset + deltaBytes <= bytes.byteLength; offset += deltaBytes) {
    x += float16(view.getUint16(offset, true));
    y += float16(view.getUint16(offset + 2, true));
    points.push([x, y]);
  }
  return points;
}

function float16(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >>> 10) & 0x1f;
  const fraction = bits & 0x03ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

export function textFromProps(props: JsonRecord): string | undefined {
  const direct = stringValue(props.text);
  if (direct !== undefined) return direct;
  const richText = recordValue(props.richText);
  if (!richText) return undefined;
  const parts: string[] = [];
  collectStrings(richText, parts);
  return parts.length > 0 ? parts.join("") : undefined;
}

export function assetReference(asset: VerifiedAsset): JsonRecord {
  return { assetId: asset.id, fileName: asset.fileName, mimeType: asset.mimeType, width: asset.actualWidth, height: asset.actualHeight, byteSize: asset.actualByteSize, contentSha256: asset.actualContentSha256 };
}

export function dimension(value: unknown, fallback = 0): number {
  const parsed = numberValue(value);
  return parsed !== undefined && parsed > 0 ? parsed : fallback;
}

export function elementId(value: string): string {
  return `element-${hashString(value).slice(0, 24)}`;
}

export function hashString(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function collectStrings(value: unknown, parts: string[]): void {
  if (typeof value === "string") {
    parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, parts));
    return;
  }
  if (isRecord(value)) Object.values(value).forEach((item) => collectStrings(item, parts));
}

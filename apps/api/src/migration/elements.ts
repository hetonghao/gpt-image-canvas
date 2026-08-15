import { createHash } from "node:crypto";
import { arrayValue, isRecord, numberValue, recordValue, stringValue } from "./json.js";
import type { SourceShape } from "./source-types.js";
import type { JsonRecord, VerifiedAsset } from "./types.js";

export type TargetElement = JsonRecord;

export function businessData(shape: SourceShape): JsonRecord {
  return { "ai-cove": { kind: shape.type, schemaVersion: 1, sourceShapeHash: hashString(shape.id) } };
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
  if (!points) return [];
  return points.flatMap((point): [number, number][] => {
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

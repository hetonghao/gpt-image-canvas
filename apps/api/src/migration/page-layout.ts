import { numberValue, stringValue } from "./json.js";
import type { SourceShape } from "./source-types.js";
import type { JsonRecord } from "./types.js";

export type PageOffset = {
  readonly x: number;
  readonly y: number;
};

export function pageLayout(pages: readonly JsonRecord[], shapes: readonly SourceShape[]): ReadonlyMap<string, PageOffset> {
  if (pages.length < 2) return new Map();
  const pageIds = pages
    .map((page) => ({ id: stringValue(page.id), index: stringValue(page.index) ?? "" }))
    .filter((page): page is { readonly id: string; readonly index: string } => page.id !== undefined)
    .sort((left, right) => left.index.localeCompare(right.index) || left.id.localeCompare(right.id));
  const firstPage = pageIds[0];
  if (!firstPage) return new Map();
  const bounds = new Map(pageIds.map((page) => [page.id, pageBounds(shapes.filter((shape) => shape.pageId === page.id))] as const));
  const firstBounds = bounds.get(firstPage.id);
  if (!firstBounds) return new Map();
  const offsets = new Map<string, PageOffset>([[firstPage.id, { x: 0, y: 0 }]]);
  let cursor = firstBounds.maxX;
  for (const page of pageIds.slice(1)) {
    const current = bounds.get(page.id);
    if (!current) continue;
    offsets.set(page.id, { x: cursor + 400 - current.minX, y: firstBounds.minY - current.minY });
    cursor += current.maxX - current.minX + 400;
  }
  return offsets;
}

function pageBounds(shapes: readonly SourceShape[]): { readonly minX: number; readonly maxX: number; readonly minY: number } | undefined {
  if (shapes.length === 0) return undefined;
  const minX = Math.min(...shapes.map((shape) => shape.x));
  const maxX = Math.max(...shapes.map((shape) => shape.x + (positiveDimension(shape.props.w) ? numberValue(shape.props.w) ?? 0 : 0)));
  const minY = Math.min(...shapes.map((shape) => shape.y));
  return { minX, maxX, minY };
}

function positiveDimension(value: unknown): boolean {
  const parsed = numberValue(value);
  return parsed !== undefined && parsed > 0;
}

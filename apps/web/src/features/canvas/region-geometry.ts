import type { NormalizedImageRegion } from "@gpt-image-canvas/shared";
import type { CanvasImageShape } from "./canvas-editor";

export type RegionResizeHandle = "nw" | "ne" | "se" | "sw";

interface Point {
  x: number;
  y: number;
}

export function visibleImageSourceBounds(image: CanvasImageShape): NormalizedImageRegion {
  const crop = image.props.crop;
  if (
    !crop ||
    crop.naturalWidth <= 0 ||
    crop.naturalHeight <= 0 ||
    crop.width <= 0 ||
    crop.height <= 0
  ) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  return {
    x: clamp(crop.x / crop.naturalWidth, 0, 1),
    y: clamp(crop.y / crop.naturalHeight, 0, 1),
    width: clamp(crop.width / crop.naturalWidth, 0, 1),
    height: clamp(crop.height / crop.naturalHeight, 0, 1)
  };
}

export function pagePointFromNormalizedImagePoint(image: CanvasImageShape, point: Point): Point {
  const visible = visibleImageSourceBounds(image);
  let x = (point.x - visible.x) / visible.width;
  let y = (point.y - visible.y) / visible.height;
  if (image.props.flipX) x = 1 - x;
  if (image.props.flipY) y = 1 - y;

  const center = { x: image.x + image.props.w / 2, y: image.y + image.props.h / 2 };
  return rotatePoint(
    { x: image.x + x * image.props.w, y: image.y + y * image.props.h },
    center,
    image.rotation ?? 0
  );
}

export function normalizedImagePointFromPagePoint(image: CanvasImageShape, point: Point): Point {
  const visible = visibleImageSourceBounds(image);
  const center = { x: image.x + image.props.w / 2, y: image.y + image.props.h / 2 };
  const unrotated = rotatePoint(point, center, -(image.rotation ?? 0));
  let x = (unrotated.x - image.x) / image.props.w;
  let y = (unrotated.y - image.y) / image.props.h;
  if (image.props.flipX) x = 1 - x;
  if (image.props.flipY) y = 1 - y;

  return {
    x: clamp(visible.x + x * visible.width, visible.x, visible.x + visible.width),
    y: clamp(visible.y + y * visible.height, visible.y, visible.y + visible.height)
  };
}

export function isPagePointInsideImage(image: CanvasImageShape, point: Point): boolean {
  if (image.props.w <= 0 || image.props.h <= 0) return false;
  const center = { x: image.x + image.props.w / 2, y: image.y + image.props.h / 2 };
  const unrotated = rotatePoint(point, center, -(image.rotation ?? 0));
  return (
    unrotated.x >= image.x &&
    unrotated.x <= image.x + image.props.w &&
    unrotated.y >= image.y &&
    unrotated.y <= image.y + image.props.h
  );
}

export function defaultRegionForImagePoint(image: CanvasImageShape, point: Point): NormalizedImageRegion {
  const visible = visibleImageSourceBounds(image);
  const width = visible.width * 0.24;
  const height = visible.height * 0.24;
  return clampRegionToVisible(
    visible,
    { x: point.x - width / 2, y: point.y - height / 2, width, height }
  );
}

export function regionFromImageDrag(image: CanvasImageShape, start: Point, end: Point): NormalizedImageRegion {
  const first = normalizedImagePointFromPagePoint(image, start);
  const last = normalizedImagePointFromPagePoint(image, end);
  const width = Math.abs(last.x - first.x);
  const height = Math.abs(last.y - first.y);
  if (width < 0.01 || height < 0.01) return defaultRegionForImagePoint(image, last);

  return clampRegionToVisible(visibleImageSourceBounds(image), {
    x: Math.min(first.x, last.x),
    y: Math.min(first.y, last.y),
    width,
    height
  });
}

export function moveImageRegion(
  image: CanvasImageShape,
  region: NormalizedImageRegion,
  offset: Point
): NormalizedImageRegion {
  const visible = visibleImageSourceBounds(image);
  return {
    ...region,
    x: clamp(region.x + offset.x, visible.x, visible.x + visible.width - region.width),
    y: clamp(region.y + offset.y, visible.y, visible.y + visible.height - region.height)
  };
}

export function resizeImageRegion(
  image: CanvasImageShape,
  region: NormalizedImageRegion,
  handle: RegionResizeHandle,
  point: Point
): NormalizedImageRegion {
  const visible = visibleImageSourceBounds(image);
  const minWidth = Math.min(0.01, visible.width);
  const minHeight = Math.min(0.01, visible.height);
  const left = handle.endsWith("w")
    ? clamp(point.x, visible.x, region.x + region.width - minWidth)
    : region.x;
  const right = handle.endsWith("e")
    ? clamp(point.x, region.x + minWidth, visible.x + visible.width)
    : region.x + region.width;
  const top = handle.startsWith("n")
    ? clamp(point.y, visible.y, region.y + region.height - minHeight)
    : region.y;
  const bottom = handle.startsWith("s")
    ? clamp(point.y, region.y + minHeight, visible.y + visible.height)
    : region.y + region.height;

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function imageRegionPageCorners(image: CanvasImageShape, region: NormalizedImageRegion): readonly Point[] {
  return [
    pagePointFromNormalizedImagePoint(image, { x: region.x, y: region.y }),
    pagePointFromNormalizedImagePoint(image, { x: region.x + region.width, y: region.y }),
    pagePointFromNormalizedImagePoint(image, { x: region.x + region.width, y: region.y + region.height }),
    pagePointFromNormalizedImagePoint(image, { x: region.x, y: region.y + region.height })
  ];
}

function clampRegionToVisible(visible: NormalizedImageRegion, region: NormalizedImageRegion): NormalizedImageRegion {
  const width = Math.min(region.width, visible.width);
  const height = Math.min(region.height, visible.height);
  return {
    x: clamp(region.x, visible.x, visible.x + visible.width - width),
    y: clamp(region.y, visible.y, visible.y + visible.height - height),
    width,
    height
  };
}

function rotatePoint(point: Point, center: Point, angle: number): Point {
  if (!angle) return point;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

import assert from "node:assert/strict";
import type { CanvasImageShape } from "./canvas-editor";
import {
  defaultRegionForImagePoint,
  moveImageRegion,
  normalizedImagePointFromPagePoint,
  pagePointFromNormalizedImagePoint,
  regionFromImageDrag,
  resizeImageRegion,
  visibleImageSourceBounds
} from "./region-geometry";

const image: CanvasImageShape = {
  id: "image-rotated",
  type: "image",
  x: 100,
  y: 200,
  rotation: Math.PI / 2,
  props: {
    assetId: "file-rotated",
    w: 240,
    h: 120,
    crop: {
      x: 100,
      y: 50,
      width: 400,
      height: 200,
      naturalWidth: 800,
      naturalHeight: 400
    },
    flipX: true,
    flipY: false
  }
};

function closeTo(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 0.000_001, `${message}: expected ${expected}, received ${actual}`);
}

// Given a rotated, flipped, cropped source image.
// When a source point is projected to the canvas and read back.
// Then the normalized source-image coordinate is preserved.
const sourcePoint = { x: 0.3, y: 0.4 };
const canvasPoint = pagePointFromNormalizedImagePoint(image, sourcePoint);
const roundTripPoint = normalizedImagePointFromPagePoint(image, canvasPoint);
closeTo(roundTripPoint.x, sourcePoint.x, "round-trip x");
closeTo(roundTripPoint.y, sourcePoint.y, "round-trip y");

// Given a click inside the cropped image.
// When the default region is created.
// Then it remains inside the visible source bounds.
const visibleBounds = visibleImageSourceBounds(image);
const clickedRegion = defaultRegionForImagePoint(image, sourcePoint);
closeTo(clickedRegion.width, visibleBounds.width * 0.24, "default width follows visible source content");
closeTo(clickedRegion.height, visibleBounds.height * 0.24, "default height follows visible source content");
assert.ok(clickedRegion.x >= visibleBounds.x && clickedRegion.x + clickedRegion.width <= visibleBounds.x + visibleBounds.width);
assert.ok(clickedRegion.y >= visibleBounds.y && clickedRegion.y + clickedRegion.height <= visibleBounds.y + visibleBounds.height);

// Given two canvas points over the transformed image.
// When the user drags between them.
// Then the stored region uses source-image normalized coordinates.
const dragStart = { x: 0.2, y: 0.25 };
const dragEnd = { x: 0.45, y: 0.55 };
const draggedRegion = regionFromImageDrag(
  image,
  pagePointFromNormalizedImagePoint(image, dragStart),
  pagePointFromNormalizedImagePoint(image, dragEnd)
);
closeTo(draggedRegion.x, 0.2, "drag x");
closeTo(draggedRegion.y, 0.25, "drag y");
closeTo(draggedRegion.width, 0.25, "drag width");
closeTo(draggedRegion.height, 0.3, "drag height");

// Given an existing region near the visible crop edge.
// When it is moved and resized past that edge.
// Then it stays within the visible source content and keeps a usable size.
const movedRegion = moveImageRegion(image, { x: 0.2, y: 0.2, width: 0.15, height: 0.15 }, { x: 1, y: 1 });
closeTo(movedRegion.x + movedRegion.width, visibleBounds.x + visibleBounds.width, "move right edge");
closeTo(movedRegion.y + movedRegion.height, visibleBounds.y + visibleBounds.height, "move bottom edge");
const resizedRegion = resizeImageRegion(
  image,
  { x: 0.2, y: 0.2, width: 0.15, height: 0.15 },
  "se",
  { x: 1, y: 1 }
);
closeTo(resizedRegion.x + resizedRegion.width, visibleBounds.x + visibleBounds.width, "resize right edge");
closeTo(resizedRegion.y + resizedRegion.height, visibleBounds.y + visibleBounds.height, "resize bottom edge");

process.stdout.write("region-geometry.smoke.ts passed (click + transformed drag + move + resize)\n");

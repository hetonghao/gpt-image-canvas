import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(currentDir, "../..");
const assetsRoot = path.join(sourceRoot, "assets");

const [canvasAppSource, generationStyles] = await Promise.all([
  readFile(path.join(currentDir, "CanvasApp.tsx"), "utf8"),
  readFile(path.join(sourceRoot, "styles/generation.css"), "utf8")
]);

assert.match(canvasAppSource, /magicWandAutoIconUrl/u, "auto region annotation should use the custom magic wand asset");
assert.match(canvasAppSource, /magicWandManualIconUrl/u, "manual region annotation should use the custom magic wand asset");
assert.match(canvasAppSource, /<MagicWandRegionIcon className="size-3\.5" variant="auto" \/>/u, "auto annotation mode uses the magic wand icon");
assert.match(canvasAppSource, /<MagicWandRegionIcon className="size-3\.5" variant="manual" \/>/u, "manual annotation mode uses the manual magic wand icon");

assert.match(generationStyles, /magic-wand-cursor-auto\.png/u, "auto annotation cursor uses the generated cursor asset");
assert.match(generationStyles, /magic-wand-cursor-manual\.png/u, "manual annotation cursor uses the generated cursor asset");
assert.doesNotMatch(generationStyles, /data:image\/svg\+xml[\s\S]*region-annotation-mode="auto"/u, "auto annotation cursor should not be an inline SVG");

for (const assetName of [
  "magic-wand-auto.png",
  "magic-wand-manual.png",
  "magic-wand-cursor-auto.png",
  "magic-wand-cursor-manual.png"
]) {
  const png = await readFile(path.join(assetsRoot, assetName));
  assertPngHasAlpha(png, assetName);
  assert.ok(png.byteLength < 25_000, `${assetName} should stay small enough for the UI bundle`);
}

const manualMarkerOverlap = await countTealMarkerPixels(path.join(assetsRoot, "magic-wand-manual.png"), {
  left: 46,
  top: 66,
  width: 55,
  height: 51
});
assert.ok(manualMarkerOverlap < 80, "manual marker should not cover the magic wand body at icon size");
const manualMarkerBadge = await countTealMarkerPixels(path.join(assetsRoot, "magic-wand-manual.png"), {
  left: 78,
  top: 16,
  width: 35,
  height: 35
});
assert.ok(manualMarkerBadge > 200, "manual icon should keep a small marker badge separate from the wand body");

process.stdout.write("region-prompt-icons.smoke.ts passed\n");

function assertPngHasAlpha(png: Buffer, assetName: string): void {
  assert.equal(png.toString("ascii", 1, 4), "PNG", `${assetName} should be a PNG`);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colorType = png.readUInt8(25);

  assert.ok(width > 0 && height > 0, `${assetName} should have dimensions`);
  assert.equal(colorType, 6, `${assetName} should be RGBA with transparency`);
}

async function countTealMarkerPixels(
  assetPath: string,
  rect: { left: number; top: number; width: number; height: number }
): Promise<number> {
  const decoded = decodeRgbaPng(await readFile(assetPath));
  let count = 0;
  const bottom = rect.top + rect.height;
  const right = rect.left + rect.width;

  for (let y = rect.top; y < bottom; y += 1) {
    for (let x = rect.left; x < right; x += 1) {
      const offset = (y * decoded.width + x) * 4;
      const red = decoded.rgba[offset];
      const green = decoded.rgba[offset + 1];
      const blue = decoded.rgba[offset + 2];
      const alpha = decoded.rgba[offset + 3];
      const isTealMarker = alpha > 80 && red >= 5 && red <= 35 && green >= 100 && green <= 135 && blue >= 95 && blue <= 125;
      if (isTealMarker) {
        count += 1;
      }
    }
  }

  return count;
}

function decodeRgbaPng(png: Buffer): { width: number; height: number; rgba: Buffer } {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png.readUInt8(24);
  const colorType = png.readUInt8(25);
  assert.equal(bitDepth, 8, "icon smoke decoder expects 8-bit PNG assets");
  assert.equal(colorType, 6, "icon smoke decoder expects RGBA PNG assets");

  const chunks: Buffer[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (type === "IDAT") {
      chunks.push(png.subarray(dataStart, dataEnd));
    }
    offset = dataEnd + 4;
    if (type === "IEND") {
      break;
    }
  }

  const inflated = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const rgba = Buffer.alloc(stride * height);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const row = inflated.subarray(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    const outputOffset = y * stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? rgba[outputOffset + x - 4] : 0;
      const up = y > 0 ? rgba[outputOffset - stride + x] : 0;
      const upLeft = y > 0 && x >= 4 ? rgba[outputOffset - stride + x - 4] : 0;
      rgba[outputOffset + x] = (row[x] + pngFilterValue(filter, left, up, upLeft)) & 0xff;
    }
  }

  return { width, height, rgba };
}

function pngFilterValue(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return Math.floor((left + up) / 2);
    case 4:
      return paethPredictor(left, up, upLeft);
    default:
      throw new Error(`Unsupported PNG filter type: ${filter}`);
  }
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  return upDistance <= upLeftDistance ? up : upLeft;
}

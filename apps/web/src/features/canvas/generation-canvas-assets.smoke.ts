import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(currentDir, "CanvasApp.tsx"), "utf8");

assert.match(
  source,
  /const GENERATED_ASSET_INITIAL_PREVIEW_WIDTH: AssetPreviewWidth = 1024;/u,
  "generated images should start with the same 1K preview size that gallery cards already prove reliable"
);

assert.match(
  source,
  /function generatedCanvasDisplayUrl\(asset: Pick<GeneratedAsset, "id">\): string \{[\s\S]*return assetPreviewUrl\(asset\.id, GENERATED_ASSET_INITIAL_PREVIEW_WIDTH\);[\s\S]*\}/u,
  "generated canvas images should use one helper for their display preview URL"
);

const createImageAssetBody = functionBody("createImageAsset");
const createImageShapeBody = functionBody("createImageShape");
const preloadGeneratedAssetPreviewBody = functionBody("preloadGeneratedAssetPreview");
const resolveCanvasAssetUrlBody = functionBody("resolveCanvasAssetUrl");

assert.match(createImageAssetBody, /const displayUrl = generatedCanvasDisplayUrl\(asset\);/u, "tldraw assets should derive src from the display preview helper");
assert.match(createImageAssetBody, /src: displayUrl/u, "tldraw asset fallback src should be the generated preview URL");
assert.match(createImageAssetBody, /originalUrl: generatedCanvasOriginalUrl\(asset\)/u, "generated assets should retain their original URL for original-resolution operations");
assert.doesNotMatch(createImageAssetBody, /src:\s*normalizeAssetUrl\(asset\.url\)/u, "generated asset display src should not use the raw asset URL directly");

assert.match(createImageShapeBody, /url: generatedCanvasOriginalUrl\(asset\)/u, "shape link URL should keep opening the original generated asset");
assert.doesNotMatch(createImageShapeBody, /url:\s*normalizeAssetUrl\(asset\.url\)/u, "createImageShape should use the shared original URL helper");

assert.match(
  preloadGeneratedAssetPreviewBody,
  /preloadImageUrl\(generatedCanvasDisplayUrl\(asset\), signal\)/u,
  "preload and canvas rendering should target the same generated image display URL"
);

assert.match(
  resolveCanvasAssetUrlBody,
  /if \(context\.shouldResolveToOriginal\) \{[\s\S]*return getOriginalAssetUrl\(asset\) \?\? sourceUrl;[\s\S]*\}/u,
  "original-resolution resolution should use the stored original URL instead of the preview fallback"
);

process.stdout.write("generation-canvas-assets.smoke.ts passed\n");

function functionBody(functionName: string): string {
  const signatureIndex = source.indexOf(`function ${functionName}`);
  assert.notEqual(signatureIndex, -1, `${functionName} should exist`);

  const openBraceIndex = source.indexOf("{\n", signatureIndex);
  assert.notEqual(openBraceIndex, -1, `${functionName} should have a body`);

  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex, index + 1);
      }
    }
  }

  assert.fail(`${functionName} body should close`);
}

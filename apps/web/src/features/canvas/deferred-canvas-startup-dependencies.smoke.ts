import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDir, "../../..");
const distRoot = path.join(webRoot, "dist");
const distAssetsRoot = path.join(distRoot, "assets");
const distIndexHtml = await readFile(path.join(distRoot, "index.html"), "utf8");
const distAssets = await readdir(distAssetsRoot);
const mainChunkName = singleAsset(distAssets, /^index-[^.]+\.js$/u, "canvas startup chunk");
const canvasRuntimeChunkName = singleAsset(distAssets, /^mount-canvas-runtime-[^.]+\.js$/u, "canvas runtime chunk");
const excalidrawChunkName = singleAsset(distAssets, /^ExcalidrawCanvas-[^.]+\.js$/u, "Excalidraw canvas chunk");
const excalidrawCssName = singleAsset(distAssets, /^ExcalidrawCanvas-[^.]+\.css$/u, "Excalidraw canvas stylesheet");
const promptRegionEditorChunkName = singleAsset(distAssets, /^PromptRegionEditor-[^.]+\.js$/u, "PromptRegionEditor chunk");
const mainChunkSource = await readFile(path.join(distAssetsRoot, mainChunkName), "utf8");
const canvasRuntimeChunkSource = await readFile(path.join(distAssetsRoot, canvasRuntimeChunkName), "utf8");

assert.ok(mainChunkSource.length < 20 * 1024, `Canvas startup chunk should stay under 20 KiB, got ${mainChunkSource.length} bytes`);
assert.ok(!distIndexHtml.includes('rel="stylesheet"'), "Built index.html should keep the startup path free of external CSS requests");
assert.ok(!distIndexHtml.includes("mount-canvas-runtime-"), "Canvas runtime chunk should not be preloaded by index.html");
assert.ok(mainChunkSource.includes(canvasRuntimeChunkName), "The startup shell should defer loading the canvas runtime chunk");
assert.ok(!distIndexHtml.includes(excalidrawChunkName), "Excalidraw should not be preloaded by index.html");
assert.ok(!distIndexHtml.includes(excalidrawCssName), "Excalidraw styles should not be preloaded by index.html");
assert.ok(!mainChunkSource.includes(excalidrawChunkName), "Excalidraw should stay out of the startup shell chunk");
assert.ok(canvasRuntimeChunkSource.includes("canvas-shell"), "Canvas runtime chunk should contain the canvas shell UI");
assert.ok(canvasRuntimeChunkSource.includes(excalidrawChunkName), "Canvas runtime should defer to the canvas-only Excalidraw chunk");
assert.ok(canvasRuntimeChunkSource.includes(excalidrawCssName), "Canvas runtime should defer Excalidraw styles with the canvas-only chunk");
assert.ok(!distIndexHtml.includes(promptRegionEditorChunkName), "PromptRegionEditor should not be preloaded by index.html");
assert.ok(!mainChunkSource.includes(promptRegionEditorChunkName), "PromptRegionEditor should stay out of the startup shell chunk");
assert.ok(canvasRuntimeChunkSource.includes(promptRegionEditorChunkName), "Canvas runtime should retain PromptRegionEditor as a deferred chunk");

process.stdout.write("deferred-canvas-startup-dependencies.smoke.ts passed\n");

function singleAsset(assets: string[], pattern: RegExp, label: string): string {
  const matches = assets.filter((asset) => pattern.test(asset));
  assert.equal(matches.length, 1, `Expected exactly one ${label}, found ${matches.length}: ${matches.join(", ")}`);
  return matches[0] ?? assert.fail(`Missing ${label}`);
}

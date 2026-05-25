import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDir, "../../..");
const distRoot = path.join(webRoot, "dist");
const distAssetsRoot = path.join(distRoot, "assets");
const canvasAppSource = await readFile(path.join(currentDir, "CanvasApp.tsx"), "utf8");
const promptRegionEditorSource = await readFile(path.join(currentDir, "PromptRegionEditor.tsx"), "utf8");

const runtimePromptRegionEditorImports = Array.from(
  canvasAppSource.matchAll(/^\s*import\s+(?!type\b)[^;]*\bfrom\s+["']\.\/PromptRegionEditor["'];/gmu)
);

assert.ok(
  promptRegionEditorSource.includes("@codemirror/"),
  "PromptRegionEditor should remain the module that owns CodeMirror dependencies"
);
assert.ok(!canvasAppSource.includes("@codemirror/"), "CanvasApp should not import CodeMirror directly");
assert.deepEqual(runtimePromptRegionEditorImports, [], "PromptRegionEditor should not be statically imported into the canvas startup bundle");
assert.match(canvasAppSource, /import\(["']\.\/PromptRegionEditor["']\)/u, "PromptRegionEditor should be loaded only when region prompt editing is active");

const distIndexHtml = await readFile(path.join(distRoot, "index.html"), "utf8").catch((error: unknown) => {
  throw new Error(`Built web bundle is required before this smoke. Run pnpm --filter @gpt-image-canvas/web build first. ${String(error)}`);
});
const distAssets = await readdir(distAssetsRoot);
const mainChunkName = singleAsset(distAssets, /^index-[^.]+\.js$/u, "canvas startup chunk");
const promptRegionEditorChunkName = singleAsset(distAssets, /^PromptRegionEditor-[^.]+\.js$/u, "PromptRegionEditor chunk");
const mainChunkSource = await readFile(path.join(distAssetsRoot, mainChunkName), "utf8");
const promptRegionEditorChunkSource = await readFile(path.join(distAssetsRoot, promptRegionEditorChunkName), "utf8");

assert.ok(!distIndexHtml.includes("PromptRegionEditor-"), "PromptRegionEditor chunk should not be preloaded by index.html");
assert.ok(!mainChunkSource.includes("cm-editor"), "CodeMirror editor styles should stay out of the canvas startup chunk");
assert.ok(!mainChunkSource.includes("EditorView"), "CodeMirror EditorView implementation should stay out of the canvas startup chunk");
assert.ok(promptRegionEditorChunkSource.includes("cm-editor"), "PromptRegionEditor chunk should contain the CodeMirror editor implementation");
assert.ok(promptRegionEditorChunkSource.includes("EditorView"), "PromptRegionEditor chunk should contain the CodeMirror runtime implementation");

process.stdout.write("deferred-canvas-startup-dependencies.smoke.ts passed\n");

function singleAsset(assets: string[], pattern: RegExp, label: string): string {
  const matches = assets.filter((asset) => pattern.test(asset));
  assert.equal(matches.length, 1, `Expected exactly one ${label}, found ${matches.length}: ${matches.join(", ")}`);
  return matches[0]!;
}

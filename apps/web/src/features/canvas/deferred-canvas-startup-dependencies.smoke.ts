import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDir, "../../..");
const distRoot = path.join(webRoot, "dist");
const distAssetsRoot = path.join(distRoot, "assets");
const mainSource = await readFile(path.join(webRoot, "src", "main.tsx"), "utf8");
const mountRuntimeSource = await readFile(path.join(webRoot, "src", "mount-canvas-runtime.tsx"), "utf8");
const canvasAppSource = await readFile(path.join(currentDir, "CanvasApp.tsx"), "utf8");
const promptRegionEditorSource = await readFile(path.join(currentDir, "PromptRegionEditor.tsx"), "utf8");

const runtimePromptRegionEditorImports = Array.from(
  canvasAppSource.matchAll(/^\s*import\s+(?!type\b)[^;]*\bfrom\s+["']\.\/PromptRegionEditor["'];/gmu)
);

assert.match(mainSource, /import\(["']\.\/mount-canvas-runtime["']\)/u, "main.tsx should only lazy-load the full canvas runtime");
assert.ok(!mainSource.includes("react-dom/client"), "main.tsx should not import ReactDOM before the startup shell paints");
assert.ok(!mainSource.includes("LanguageProvider"), "main.tsx should not import the full i18n table before the startup shell mounts");
assert.ok(!mainSource.includes('"./styles.css"'), "main.tsx should not request the full app CSS before the startup shell mounts");
assert.ok(!mainSource.includes('"tldraw/tldraw.css"'), "main.tsx should not request Tldraw CSS before the startup shell mounts");
assert.ok(mountRuntimeSource.includes('import "tldraw/tldraw.css";'), "mount-canvas-runtime should load Tldraw CSS with the full runtime");
assert.ok(mountRuntimeSource.includes('import "./styles.css";'), "mount-canvas-runtime should load app CSS with the full runtime");

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
const canvasRuntimeChunkName = singleAsset(distAssets, /^mount-canvas-runtime-[^.]+\.js$/u, "canvas runtime chunk");
const promptRegionEditorChunkName = singleAsset(distAssets, /^PromptRegionEditor-[^.]+\.js$/u, "PromptRegionEditor chunk");
const mainChunkSource = await readFile(path.join(distAssetsRoot, mainChunkName), "utf8");
const canvasRuntimeChunkSource = await readFile(path.join(distAssetsRoot, canvasRuntimeChunkName), "utf8");
const promptRegionEditorChunkSource = await readFile(path.join(distAssetsRoot, promptRegionEditorChunkName), "utf8");

assert.ok(mainChunkSource.length < 20 * 1024, `Canvas startup chunk should stay under 20 KiB, got ${mainChunkSource.length} bytes`);
assert.ok(!distIndexHtml.includes('rel="stylesheet"'), "Built index.html should keep the startup path free of external CSS requests");
assert.ok(!distIndexHtml.includes("mount-canvas-runtime-"), "Canvas runtime chunk should not be preloaded by index.html");
assert.ok(!mainChunkSource.includes("agent-history-dialog"), "Agent history UI should stay out of the first startup chunk");
assert.ok(!mainChunkSource.includes("canvas-shell"), "Canvas shell UI should stay out of the first startup chunk");
assert.ok(!mainChunkSource.includes("tldraw-2026"), "Tldraw runtime should stay out of the first startup chunk");
assert.ok(canvasRuntimeChunkSource.includes("canvas-shell"), "Canvas runtime chunk should contain the canvas shell UI");
assert.ok(canvasRuntimeChunkSource.includes("tldraw-2026"), "Canvas runtime chunk should contain the Tldraw runtime");
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

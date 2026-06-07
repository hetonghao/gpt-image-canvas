import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const stylesRoot = path.resolve(currentDir, "../../styles");

const [placeholderSource, canvasAppSource, canvasStyles] = await Promise.all([
  readFile(path.join(currentDir, "GenerationPlaceholderShape.tsx"), "utf8"),
  readFile(path.join(currentDir, "CanvasApp.tsx"), "utf8"),
  readFile(path.join(stylesRoot, "canvas.css"), "utf8")
]);

assert.ok(placeholderSource.includes("ResizeObserver"), "particle canvas sizing should use ResizeObserver instead of per-frame layout reads");
assert.doesNotMatch(
  placeholderSource,
  /const renderFrame[\s\S]*?getBoundingClientRect/u,
  "particle canvas render frames should not call getBoundingClientRect"
);
assert.ok(
  canvasAppSource.includes("GENERATION_PLACEHOLDER_MOTION_QUIET_CLASS"),
  "canvas interactions should expose a shared quiet-motion class for generation placeholders"
);
assert.ok(
  canvasAppSource.includes("generationPlaceholderPointerIdsRef"),
  "generation placeholder quiet mode should track multiple active pointers"
);
assert.match(
  canvasStyles,
  /\.generation-placeholder-motion-quiet[\s\S]*generation-placeholder-shape__particle-canvas/u,
  "quiet mode should fade or hide the expensive particle canvas while dragging"
);
assert.match(
  canvasStyles,
  /\.generation-placeholder-motion-quiet[\s\S]*animation-play-state:\s*paused/u,
  "quiet mode should pause placeholder CSS animations while dragging"
);

process.stdout.write("generation-placeholder-motion.smoke.ts passed\n");

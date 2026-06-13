import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(currentDir, "CanvasApp.tsx"), "utf8");

test("canvas history asset action reveals the local file in desktop runtime before falling back to download", () => {
  assert.match(
    source,
    /import \{ revealDesktopAssetFile \} from "\.\.\/\.\.\/shared\/desktop\/desktop-asset";/u,
    "Canvas history actions should use the shared desktop asset helper"
  );
  assert.match(
    source,
    /if \(await revealDesktopAssetFile\(asset\.id\)\) \{\s*setGenerationMessage\(t\("generationRevealOpened"\)\);\s*return;\s*\}/u,
    "Desktop canvas history action should reveal the local file when available"
  );
  assert.match(
    source,
    /window\.open\(assetDownloadUrl\(asset\.id\), "_blank", "noopener,noreferrer"\);/u,
    "Canvas history action should still fall back to the existing download behavior"
  );
  assert.match(
    source,
    /title=\{downloadableAsset \? \(isDesktopRuntime \? t\("historyRevealInFolder"\) : t\("commonDownload"\)\) : t\("generationHistoryNoDownload"\)\}/u,
    "Desktop canvas history action should expose a Finder or Explorer tooltip"
  );
});

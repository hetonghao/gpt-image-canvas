import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const canvasSource = await readFile(path.join(currentDir, "CanvasApp.tsx"), "utf8");

test("keeps the mounted canvas alive while a host-session recheck is blocked", () => {
  assert.match(
    canvasSource,
    /const hasMountedEditor = editorHasMountedRef\.current;\s+const shouldBlockCanvasForHostSession = isHostSessionBlocked && !hasMountedEditor;\s+const shouldShowHostSessionRecovery = isHostSessionBlocked && hasMountedEditor;/u,
    "Host-session errors after Tldraw mounts must not unmount the editor"
  );
  assert.match(
    canvasSource,
    /\{shouldBlockCanvasForHostSession \? <div role="alert">\{hostSessionErrorPanel\}<\/div> : isProjectLoaded \?/u,
    "The initial host-session block should remain separate from the mounted-editor path"
  );
  assert.match(
    canvasSource,
    /data-testid="canvas-host-session-overlay"/u,
    "A recheck failure should render a recoverable overlay"
  );
  assert.match(
    canvasSource,
    /\.\.\.\(shouldShowHostSessionRecovery \? \{ inert: "" \} : \{\}\)/u,
    "The recovery overlay should block interaction with the stale session"
  );
});

test("keeps the mounted editor callback stable during host-session recovery", () => {
  assert.match(
    canvasSource,
    /const hostSessionBlockedRef = useRef\(false\);/u,
    "Mounted editor callbacks must read host-session state from a ref"
  );
  assert.match(canvasSource, /hostSessionBlockedRef\.current = isHostSessionBlocked;/u);
  assert.doesNotMatch(
    canvasSource,
    /\}, \[isHostSessionBlocked, locale, saveProjectSnapshot, t\]\);/u,
    "A host-session recheck must not replace the Tldraw onMount callback"
  );
});

test("keeps the canvas mounted when editor cleanup races a host-session failure", () => {
  assert.match(
    canvasSource,
    /const editorHasMountedRef = useRef\(false\);/u,
    "The recovery boundary needs a mount marker independent of the live editor ref"
  );
  assert.match(
    canvasSource,
    /editorHasMountedRef\.current = true;/u,
    "Tldraw mount must preserve the recovery boundary"
  );
  assert.match(
    canvasSource,
    /const hasMountedEditor = editorHasMountedRef\.current;/u,
    "Host-session errors must use the preserved mount marker"
  );
});

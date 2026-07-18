import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "CodexLoginDialog.tsx");

test("uses the shared modal focus contract for Codex login", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /useModalFocus/u);
  assert.match(source, /createPortal/u);
  assert.match(source, /ref=\{dialogRef\}/u);
  assert.match(source, /aria-modal="true"/u);
  assert.match(source, /role="dialog"/u);
});

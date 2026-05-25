import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(currentDir, "../..");

const [indexHtml, tokensCss, tailwindConfig] = await Promise.all([
  readFile(path.join(webRoot, "index.html"), "utf8"),
  readFile(path.join(currentDir, "tokens.css"), "utf8"),
  readFile(path.join(webRoot, "tailwind.config.ts"), "utf8")
]);

assert.ok(!indexHtml.includes("fonts.googleapis.com"), "index.html should not reference fonts.googleapis.com");
assert.ok(!indexHtml.includes("fonts.gstatic.com"), "index.html should not reference fonts.gstatic.com");
assert.ok(
  !indexHtml.includes('rel="stylesheet"') || !indexHtml.includes("fonts.googleapis.com/css2"),
  "index.html should not include a Google Fonts stylesheet link"
);

for (const [name, content] of [
  ["tokens.css", tokensCss],
  ["tailwind.config.ts", tailwindConfig]
] as const) {
  assert.ok(!content.includes("Noto Sans SC"), `${name} should not reference Noto Sans SC`);
  assert.ok(!content.includes("Noto Serif SC"), `${name} should not reference Noto Serif SC`);
  assert.ok(!content.includes("IBM Plex Mono"), `${name} should not reference IBM Plex Mono`);
}

process.stdout.write("font-dependencies.smoke.ts passed\n");

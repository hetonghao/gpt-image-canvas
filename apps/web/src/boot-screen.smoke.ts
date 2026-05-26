import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceHtml = await readFile(path.join(webRoot, "index.html"), "utf8");
const builtHtml = await readFile(path.join(webRoot, "dist", "index.html"), "utf8").catch((error: unknown) => {
  throw new Error(`Built web bundle is required before this smoke. Run pnpm --filter @gpt-image-canvas/web build first. ${String(error)}`);
});

function assertIncludes(html: string, pattern: RegExp, message: string): void {
  assert.match(html, pattern, message);
}

for (const [label, html] of [
  ["source", sourceHtml],
  ["built", builtHtml]
] as const) {
  const bootThemeScriptIndex = html.indexOf("<script data-boot-theme>");
  const bootScreenStyleIndex = html.indexOf("<style data-boot-screen>");
  assertIncludes(html, /<style\b[^>]*data-boot-screen/u, `${label} HTML should inline boot-screen styles`);
  assertIncludes(html, /<script\b[^>]*data-boot-theme/u, `${label} HTML should resolve the boot theme before styles render`);
  assert.ok(bootThemeScriptIndex > 0, `${label} HTML should include a boot theme resolver`);
  assert.ok(
    bootScreenStyleIndex > bootThemeScriptIndex,
    `${label} HTML should resolve the boot theme before boot-screen styles render`
  );
  assertIncludes(html, /<div id="root">\s*<div class="boot-screen"/u, `${label} HTML should render a boot screen before React starts`);
  assertIncludes(html, /role="status"/u, `${label} boot screen should expose loading status semantics`);
  assertIncludes(html, /data-testid="boot-screen"/u, `${label} boot screen should be testable`);
  assertIncludes(html, /background:\s*#fff7e6/u, `${label} boot screen should default to the light canvas surface`);
  assertIncludes(html, /\[data-boot-theme="dark"\]/u, `${label} boot screen should still support an explicit dark theme`);
  assert.ok(!html.includes("<img"), `${label} boot screen should not add image requests before the app loads`);
}

process.stdout.write("boot-screen.smoke.ts passed\n");

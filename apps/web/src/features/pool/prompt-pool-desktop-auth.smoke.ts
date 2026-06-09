import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const [source, hostTokenSource, i18n] = await Promise.all([
  readFile(path.join(currentDir, "PromptPoolPage.tsx"), "utf8"),
  readFile(path.resolve(currentDir, "../../shared/api/host-token.ts"), "utf8"),
  readFile(path.resolve(currentDir, "../../shared/i18n/index.tsx"), "utf8")
]);

test("desktop signed-out prompt pool skips favorite requests", () => {
  assert.match(source, /import \{ apiFetch, hasHostCredentials \} from "\.\.\/\.\.\/shared\/api\/host-token";/u);
  assert.match(source, /import \{ isDesktopAuthSupported \} from "\.\.\/\.\.\/shared\/desktop\/desktop-auth";/u);
  assert.match(source, /const canUseFavorites = !isDesktopAuthSupported\(\) \|\| hasHostCredentials\(\);/u);
  assert.match(
    source,
    /if \(!canUseFavorites\) \{\s*setFavoriteGroups\(\[\]\);\s*setFavoriteItems\(\[\]\);\s*return;\s*\}[\s\S]*void loadFavoriteState\(controller\.signal\);/u,
    "Favorite loading should return before fetchPromptFavorites when desktop credentials are missing"
  );
  assert.match(hostTokenSource, /export function hasHostCredentials\(\): boolean \{\s*return Boolean\(getHostToken\(\) \|\| getHostUserId\(\)\);/u);
});

test("desktop signed-out prompt pool hides favorite controls", () => {
  assert.match(source, /showFavorite=\{canUseFavorites\}/u, "Prompt cards should receive the favorite visibility gate");
  assert.match(source, /if \(!canUseFavorites\) \{\s*showStatus\(t\("favoriteLoginRequired"\)\);\s*return;\s*\}/u);
  assert.match(i18n, /favoriteLoginRequired: "请先登录 AI Cove 后再收藏提示词。"/u);
  assert.match(i18n, /favoriteLoginRequired: "Sign in to AI Cove before saving prompts."/u);
});

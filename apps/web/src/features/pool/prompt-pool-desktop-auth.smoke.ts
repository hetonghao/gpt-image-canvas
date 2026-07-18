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
    /if \(!canUseFavorites\) return;[\s\S]*void loadFavoriteState\(controller\.signal, requestGeneration\);/u,
    "Favorite loading should return before fetchPromptFavorites when desktop credentials are missing"
  );
  assert.match(hostTokenSource, /export function hasHostCredentials\(\): boolean \{\s*return Boolean\(getHostToken\(\) \|\| getHostUserId\(\)\);/u);
});

test("desktop signed-out prompt pool hides favorite controls", () => {
  assert.match(source, /showFavorite=\{canUseFavorites\}/u, "Prompt cards should receive the favorite visibility gate");
  assert.match(source, /\{canUseFavorites && favoriteError \? \(/u, "Stale favorite errors should remain hidden while favorites are unavailable");
  assert.match(source, /\{canUseFavorites && favoritePopoverItem && favoritePopoverFavorite \? \(/u, "Stale favorite popovers should remain hidden while favorites are unavailable");
  assert.match(source, /if \(!canUseFavorites\) \{\s*showStatus\(t\("favoriteLoginRequired"\)\);\s*return;\s*\}/u);
  assert.match(i18n, /favoriteLoginRequired: "请先登录 AI Cove 后再收藏提示词。"/u);
  assert.match(i18n, /favoriteLoginRequired: "Sign in to AI Cove before saving prompts."/u);
});

test("favorite identity changes clear private view state and reject stale request results", () => {
  assert.match(source, /const favoriteIdentity = favoriteIdentityBoundary\(canUseFavorites\);/u);
  assert.match(source, /favoriteRequestGenerationRef\.current \+= 1;/u, "Identity changes should invalidate every earlier favorite request");
  assert.match(
    source,
    /setFavoriteGroups\(\[\]\);[\s\S]*setFavoriteItems\(\[\]\);[\s\S]*setFavoritePopoverSourceId\(null\);[\s\S]*setFavoriteError\(""\);/u,
    "Private favorite data and errors should clear at the identity boundary"
  );
  assert.match(
    source,
    /if \(!isCurrentFavoriteRequest\(requestGeneration\)\) \{\s*return;\s*\}/u,
    "Favorite mutations should ignore results started for an earlier identity"
  );
  assert.match(source, /loadFavoriteState\(controller\.signal, requestGeneration\)/u, "Favorite loading should carry abort and generation guards");
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(currentDir, "HomePage.tsx"), "utf8");
const canvasSource = await readFile(path.resolve(currentDir, "../canvas/CanvasApp.tsx"), "utf8");
const i18n = await readFile(path.resolve(currentDir, "../../shared/i18n/index.tsx"), "utf8");

test("desktop signed-out home keeps only the AI Cove sign-in action", () => {
  assert.match(source, /isDesktopRuntime: boolean/u, "HomePage should receive the desktop runtime signal");
  assert.match(source, /onStartDesktopAuth: \(\) => void/u, "HomePage should receive the desktop auth action");
  assert.match(source, /const isDesktopSignedIn = isDesktopRuntime && authStatus\?\.provider !== "none" && Boolean\(authStatus\);/u);
  assert.match(
    source,
    /\{isDesktopRuntime && !isDesktopSignedIn \? \(\s*<button[\s\S]*data-testid="home-ai-cove-login"[\s\S]*onClick=\{onStartDesktopAuth\}[\s\S]*\) : \(\s*<>/u,
    "Desktop signed-out state should render one AI Cove login button before the regular Web actions"
  );
  assert.match(source, /data-testid="home-codex-login"/u, "Regular Web home should keep Codex login");
  assert.match(source, /data-testid="home-api-setup"/u, "Regular Web home should keep API setup");
});

test("desktop home has explicit AI Cove copy", () => {
  assert.match(i18n, /homeDesktopProviderNone: "等待 AI Cove 登录"/u);
  assert.match(i18n, /homeStartAiCove: "登录 AI Cove"/u);
  assert.match(i18n, /desktopAuthRequired: "请先登录 AI Cove。"/u);
  assert.match(i18n, /homeDesktopProviderNone: "Waiting for AI Cove sign-in"/u);
  assert.match(i18n, /homeStartAiCove: "Sign in to AI Cove"/u);
  assert.match(i18n, /desktopAuthRequired: "Sign in to AI Cove first."/u);
});

test("desktop signed-out home suppresses host-session 401 copy", () => {
  assert.match(
    canvasSource,
    /const isDesktopAuthRequired = desktopAuthSupported && response\.status === 401;/u,
    "Desktop auth-required responses should be identified before setting user-facing errors"
  );
  assert.match(
    canvasSource,
    /setAuthError\(isDesktopAuthRequired \? "" : message\);/u,
    "Desktop signed-out state should not pass host auth 401 copy to the home page"
  );
  assert.match(
    canvasSource,
    /authError=\{desktopAuthSupported && !hostSession \? "" : authError\}/u,
    "HomePage should receive an empty auth error while the desktop user is signed out"
  );
});

test("home removes the secondary Gallery review button", () => {
  assert.doesNotMatch(source, /home-gallery-link--wide/u, "HomePage should not render the secondary Gallery review CTA");
  assert.doesNotMatch(i18n, /homeGalleryReview/u, "Unused Gallery review copy should not stay in the i18n catalog");
});

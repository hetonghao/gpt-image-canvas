import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "CanvasApp.tsx");
const brandStylesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../styles/provider-config.css");
const [source, brandStyles] = await Promise.all([readFile(sourcePath, "utf8"), readFile(brandStylesPath, "utf8")]);

test("desktop signed-out navigation hides canvas and gallery but keeps prompt pool", () => {
  assert.match(
    source,
    /const shouldLimitDesktopNav = isDesktopRuntime && !hostSession;/u,
    "TopNavigation should derive the signed-out desktop navigation state from the host session"
  );
  assert.match(
    source,
    /\{shouldLimitDesktopNav \? null : \(\s*<a[\s\S]*data-testid="nav-canvas"/u,
    "Canvas navigation should be hidden before desktop sign-in"
  );
  assert.match(
    source,
    /\{shouldLimitDesktopNav \? null : \(\s*<a[\s\S]*data-testid="nav-gallery"/u,
    "Gallery navigation should be hidden before desktop sign-in"
  );
  assert.match(source, /data-testid="nav-pool"/u, "Prompt Pool navigation should remain available");
});

test("desktop runtime keeps settings inside the account menu", () => {
  assert.match(
    source,
    /isDesktopRuntime \? null : \(\s*<button[\s\S]*data-testid="global-provider-settings"/u,
    "The standalone settings button should stay hidden in desktop runtime"
  );
  assert.match(source, /data-testid="account-menu-provider-settings"/u, "Desktop settings should be available from the account menu");
  assert.match(
    source,
    /\{isDesktopRuntime && hostSession \? \(\s*<button[\s\S]*data-testid="account-menu-provider-settings"/u,
    "Desktop settings should only be available after sign-in"
  );
});

test("web runtime does not render the desktop account menu", () => {
  assert.match(
    source,
    /\{isDesktopRuntime \? \(\s*<AccountMenu[\s\S]*onLogout=\{onLogout\}[\s\S]*\/>\s*\) : null\}/u,
    "The account menu should be guarded by the desktop runtime flag so the Web app keeps its original top navigation"
  );
});

test("brand name keeps the AI Cove Design wordmark spacing", () => {
  assert.match(source, /<p className="brand-name" title="AI  Cove Design">/u, "BrandName should expose the product name with extra AI spacing");
  assert.match(
    source,
    /<span className="brand-name__space brand-name__space--after-prefix"> <\/span>/u,
    "BrandName should make the AI-to-Cove gap explicit instead of relying on collapsed spaces"
  );
  assert.match(
    brandStyles,
    /\.brand-name__space--after-prefix\s*\{[\s\S]*width:\s*0\.34em/u,
    "BrandName should use a larger visual gap after the italic AI prefix"
  );
});

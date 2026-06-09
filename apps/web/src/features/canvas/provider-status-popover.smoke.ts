import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "CanvasApp.tsx");
const source = await readFile(sourcePath, "utf8");

test("hides the Codex login action from the provider status popover in hosted AI Cove mode", () => {
  assert.match(source, /showCodexAuthAction/u, "ProviderStatusPopover should receive an explicit Codex action visibility flag");
  assert.match(source, /showCodexAuthAction=\{!isAiCoveMode\}/u, "Hosted AI Cove mode should disable the Codex login action");
  assert.match(source, /showCodexAuthAction \? \(/u, "ProviderStatusPopover should gate the login button behind the visibility flag");
});

test("moves desktop update checks into the account menu", () => {
  assert.match(source, /function AccountMenu/u, "Top navigation should expose a right-side account menu");
  assert.match(source, /data-testid="account-menu-trigger"/u, "Account menu should have a stable trigger for verification");
  assert.match(source, /data-desktop=\{isDesktopRuntime\}/u, "Desktop account menu trigger should expose its desktop-only avatar treatment");
  assert.match(source, /account-menu__identity-copy/u, "Account menu identity text should not reuse the avatar span styles");
  assert.match(source, /data-testid="account-menu-provider-settings"/u, "Desktop provider settings should live in the account dropdown");
  assert.match(source, /\{isDesktopRuntime && hostSession \? \(\s*<button[\s\S]*data-testid="account-menu-provider-settings"/u, "Desktop settings should not appear before AI Cove sign-in");
  assert.match(source, /data-testid="account-menu-update-check"/u, "Desktop update check should live in the account dropdown");
  assert.match(source, /data-testid="account-menu-login"/u, "Desktop signed-out account menu should expose sign-in as the final action");
  assert.match(source, /account-menu__action--login/u, "Desktop signed-out account menu login should use the green login action treatment");
  assert.match(source, /onStartDesktopAuth/u, "Desktop account menu should be able to start AI Cove sign-in");
  assert.match(source, /data-testid="account-menu-logout"/u, "Account menu should expose logout");
  assert.match(source, /data-testid="account-menu-logout-confirm"/u, "Desktop logout should require an in-menu confirmation step");
  assert.match(source, /isDesktopRuntime \? null : \(\s*<button[\s\S]*data-testid="global-provider-settings"/u, "Standalone settings should be hidden in desktop runtime");
  assert.doesNotMatch(source, /data-testid="desktop-update-check"/u, "Desktop update check should not remain as a standalone top-nav button");
});

test("returns to the home route after desktop logout", () => {
  assert.match(source, /clearHostCredentials\(\);[\s\S]*navigateToRoute\("home", \{ replace: true \}\);[\s\S]*window\.location\.assign\("\/"\);/u, "Desktop logout should clear credentials and reload the home route");
});

test("clears stale generation errors after a successful insertion", () => {
  assert.match(
    source,
    /if \(insertedCount > 0\) \{[\s\S]*setGenerationError\(""\)[\s\S]*setGenerationMessage/u,
    "Successful generation insertion should clear stale errors before showing success"
  );
});

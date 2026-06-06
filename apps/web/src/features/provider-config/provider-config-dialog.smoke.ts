import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "ProviderConfigDialog.tsx");
const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../styles/provider-config.css");

const [source, styles] = await Promise.all([readFile(sourcePath, "utf8"), readFile(cssPath, "utf8")]);

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "u"))?.groups?.body ?? "";
}

test("keeps the provider config dialog layout stable during initial data loading", () => {
  assert.match(source, /isInitialConfigReady/u, "ProviderConfigDialog should gate first render behind a stable initialization state");
  assert.match(styles, /\.provider-config-dialog--initializing/u, "ProviderConfigDialog should reserve stable space while initial data loads");
  assert.match(styles, /\.provider-config-skeleton/u, "ProviderConfigDialog should show a fixed skeleton instead of streaming rows into the dialog");
});

test("lets the loaded provider config dialog height adapt to its content", () => {
  assert.doesNotMatch(cssRule(".provider-config-dialog"), /min-height/u, "Loaded ProviderConfigDialog should not keep the skeleton min-height");
  assert.match(cssRule(".provider-config-dialog--initializing"), /min-height/u, "Only the initializing ProviderConfigDialog should reserve skeleton height");
});

test("hides the Codex login action in hosted AI Cove mode", () => {
  assert.match(source, /isHostedRuntime: boolean/u, "ProviderConfigDialog should accept the parent hosted-runtime signal");
  assert.match(source, /isHostedRuntime \|\| isHostedAiCoveAdapterMode/u, "Hosted runtime should stay in AI Cove mode even if host session fails");
  assert.match(source, /!isAiCoveMode[\s\S]*data-testid="provider-codex-login"/u, "Hosted AI Cove mode should not render the provider Codex login action");
});

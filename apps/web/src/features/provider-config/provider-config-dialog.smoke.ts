import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "ProviderConfigDialog.tsx");
const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../styles/provider-config.css");
const responsiveCssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../styles/responsive.css");

const [source, styles, responsiveStyles] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(cssPath, "utf8"),
  readFile(responsiveCssPath, "utf8")
]);

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, "u"))?.groups?.body ?? "";
}

test("keeps the provider config dialog layout stable during initial data loading", () => {
  assert.match(source, /isInitialConfigReady/u, "ProviderConfigDialog should gate first render behind a stable initialization state");
  assert.match(source, /const isInitialConfigReady = Boolean\(config\) \|\| !isLoading;/u, "ProviderConfigDialog should render once the primary provider config is ready");
  assert.match(styles, /\.provider-config-dialog--initializing/u, "ProviderConfigDialog should reserve stable space while initial data loads");
  assert.match(styles, /\.provider-config-skeleton/u, "ProviderConfigDialog should show a fixed skeleton instead of streaming rows into the dialog");
});

test("lets the loaded provider config dialog height adapt to its content", () => {
  assert.doesNotMatch(cssRule(".provider-config-dialog"), /min-height/u, "Loaded ProviderConfigDialog should not keep the skeleton min-height");
  assert.match(cssRule(".provider-config-dialog--initializing"), /min-height/u, "Only the initializing ProviderConfigDialog should reserve skeleton height");
});

test("keeps provider config tab changes inside a stable scrollable dialog body", () => {
  assert.match(source, /providerConfigBodyRef/u, "ProviderConfigDialog should keep a ref to its scrollable body");
  assert.match(source, /providerConfigBodyRef\.current\?\.scrollTo\(\{ top: 0 \}\)/u, "ProviderConfigDialog should reset body scroll when tabs change");
  assert.match(cssRule(".provider-config-dialog__body"), /flex:\s*1 1 auto/u, "ProviderConfigDialog body should own the available vertical space");
  assert.match(cssRule(".provider-config-dialog__body"), /min-height:\s*0/u, "ProviderConfigDialog body should be allowed to shrink and scroll inside the modal");
});

test("uses the regular summary layout during provider onboarding", () => {
  assert.match(source, /const isSummaryTab = activeTab === "summary";/u, "Provider config should name the active Summary tab state once");
  assert.match(source, /const isSummaryOnboarding = isOnboarding && isSummaryTab;/u, "Provider onboarding should detect the optional Summary tab separately");
  assert.match(source, /const showOnboardingGuide = isOnboarding && !isSummaryTab;/u, "Provider onboarding should drop the large guide card on the optional Summary tab");
  assert.match(source, /\{showOnboardingGuide \? \(/u, "Provider onboarding guide visibility should follow the summary-tab check");
  assert.match(source, /\{isSummaryOnboarding \? null : \(\s*<header className="provider-detail-card__header">/u, "Summary onboarding should remove the duplicated Summary header row");
  assert.match(source, /provider-config-inline-hint\$\{isSummaryOnboarding \? " provider-config-inline-hint--compact" : ""\}/u, "Summary onboarding should use the compact hint treatment");
  assert.match(styles, /\.provider-detail-card--summary-onboarding/u, "Summary onboarding should have its own compact header styles");
  assert.match(styles, /\.provider-config-inline-hint--compact/u, "Summary onboarding should have a compact hint style");
  assert.match(styles, /\.provider-detail-card--summary-onboarding \.provider-form-grid/u, "Summary onboarding should tighten its field spacing");
  assert.match(styles, /\.provider-detail-card--summary-onboarding \.provider-toggle-field/u, "Summary onboarding should compact the final toggle row");
});

test("keeps the mobile provider config footer compact", () => {
  assert.match(
    responsiveStyles,
    /\.provider-config-dialog__footer\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/u,
    "Mobile provider config footer should keep Refresh and Save side by side"
  );
  assert.match(
    responsiveStyles,
    /\.provider-detail-card--agent \.provider-form-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/u,
    "Mobile Agent and Summary forms should keep compact fields in two columns"
  );
});

test("hides the Codex login action in hosted AI Cove mode", () => {
  assert.match(source, /isHostedRuntime: boolean/u, "ProviderConfigDialog should accept the parent hosted-runtime signal");
  assert.match(source, /isHostedRuntime \|\| isHostedAiCoveAdapterMode/u, "Hosted runtime should stay in AI Cove mode even if host session fails");
  assert.match(source, /!isAiCoveMode[\s\S]*data-testid="provider-codex-login"/u, "Hosted AI Cove mode should not render the provider Codex login action");
});

test("keeps AI Cove hosted selects wide and avoids duplicate model requests", () => {
  assert.match(source, /hostedModelOptionsCache/u, "ProviderConfigDialog should cache AI Cove model options across dialog instances");
  assert.match(source, /provider-field--select/u, "ProviderConfigDialog should mark hosted select fields for wider styling");
  assert.match(source, /provider-field--hosted-api-key/u, "ProviderConfigDialog should expand hosted API key selects to the full form width");
  assert.match(source, /provider-field--hosted-model/u, "ProviderConfigDialog should expand hosted model selects to the full form width");
  assert.doesNotMatch(source, /provider-field--compact[^"\n]*provider-field--hosted-model/u, "Hosted model selects should not keep compact field styling");
  assert.match(cssRule(".provider-field--select"), /min-width:\s*0/u, "Hosted select fields should be allowed to fill their grid track");
  assert.match(cssRule(".provider-field--hosted-api-key"), /grid-column:\s*1 \/ -1/u, "Hosted API key selects should not be squeezed into a compact column");
  assert.match(cssRule(".provider-field--hosted-model"), /grid-column:\s*1 \/ -1/u, "Hosted model selects should not be squeezed into a compact column");
  assert.match(cssRule(".provider-field--select .provider-field__control"), /width:\s*100%/u, "Hosted select controls should fill their field");
  assert.match(cssRule(".provider-field--select select.provider-field__control"), /height:\s*2\.55rem/u, "Hosted native select controls should keep the same visual height as text inputs");
});

test("does not block the whole provider config dialog on hosted API keys", () => {
  assert.match(source, /isHostApiKeysLoading/u, "ProviderConfigDialog should track hosted API key loading separately");
  assert.ok(source.includes('void apiFetch("/api/host/api-keys"'), "Hosted API key loading should be launched without blocking config forms");
  assert.match(source, /hostApiKeysLoading/u, "Hosted API key selects should have a loading placeholder");
});

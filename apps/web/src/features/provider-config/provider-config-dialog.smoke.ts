import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "ProviderConfigDialog.tsx");
const cssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../styles/provider-config.css");
const responsiveCssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../styles/responsive.css");
const canvasSourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../canvas/CanvasApp.tsx");
const canvasCssPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../styles/canvas-runtime.css");
const i18nPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../shared/i18n/index.tsx");
const modalFocusPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../shared/ui/use-modal-focus.ts");

const [source, styles, responsiveStyles, canvasSource, canvasStyles, i18nSource, modalFocusSource] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(cssPath, "utf8"),
  readFile(responsiveCssPath, "utf8"),
  readFile(canvasSourcePath, "utf8"),
  readFile(canvasCssPath, "utf8"),
  readFile(i18nPath, "utf8"),
  readFile(modalFocusPath, "utf8")
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

test("lets provider config tab content expand the dialog instead of creating an inner body scrollbar", () => {
  assert.doesNotMatch(source, /providerConfigBodyRef/u, "ProviderConfigDialog should not keep a body ref only for tab scroll resets");
  assert.doesNotMatch(source, /scrollTo\(\{ top: 0 \}\)/u, "ProviderConfigDialog should not force a body scroll reset when tabs change");
  assert.match(cssRule(".provider-config-dialog"), /overflow-x:\s*hidden/u, "ProviderConfigDialog should keep horizontal overflow clipped");
  assert.match(cssRule(".provider-config-dialog"), /overflow-y:\s*auto/u, "ProviderConfigDialog should own viewport overflow when content is taller than the screen");
  assert.match(cssRule(".provider-config-dialog__body"), /flex:\s*0 0 auto/u, "ProviderConfigDialog body should size to the active tab content");
  assert.match(cssRule(".provider-config-dialog__body"), /overflow-y:\s*visible/u, "ProviderConfigDialog body should not create its own vertical scrollbar");
  assert.doesNotMatch(styles, /max-height:\s*min\(36rem/u, "Desktop provider config dialog should not cap loaded tab content at 36rem");
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
  assert.match(source, /readCachedHostModels/u, "ProviderConfigDialog should reuse the identity-scoped hosted model cache");
  assert.match(source, /provider-field--select/u, "ProviderConfigDialog should mark hosted select fields for wider styling");
  assert.match(source, /provider-field--hosted-api-key/u, "ProviderConfigDialog should expand hosted API key selects to the full form width");
  assert.match(source, /provider-field--hosted-model/u, "ProviderConfigDialog should expand hosted model selects to the full form width");
  assert.doesNotMatch(source, /provider-field--compact[^"\n]*provider-field--hosted-model/u, "Hosted model selects should not keep compact field styling");
  assert.match(cssRule(".provider-field--select"), /min-width:\s*0/u, "Hosted select fields should be allowed to fill their grid track");
  assert.match(cssRule(".provider-field--hosted-api-key"), /grid-column:\s*1 \/ -1/u, "Hosted API key selects should not be squeezed into a compact column");
  assert.match(cssRule(".provider-field--hosted-model"), /grid-column:\s*1 \/ -1/u, "Hosted model selects should not be squeezed into a compact column");
  assert.match(cssRule(".provider-field--select .provider-field__control"), /width:\s*100%/u, "Hosted select controls should fill their field");
  assert.match(cssRule(".provider-field"), /--provider-control-height:\s*2\.75rem/u, "Provider fields should define one shared control height");
  assert.match(cssRule(".provider-field__control"), /min-height:\s*var\(--provider-control-height\)/u, "Text inputs should use the shared provider control height");
  assert.match(cssRule(".provider-field--select select.provider-field__control"), /height:\s*var\(--provider-control-height\)/u, "Hosted native select controls should use the same visual height as text inputs");
  assert.match(cssRule(".provider-field--select select.provider-field__control"), /min-height:\s*var\(--provider-control-height\)/u, "Hosted native select controls should not retain a separate min-height");
  assert.match(
    cssRule(".provider-detail-card--summary-onboarding .provider-field"),
    /--provider-control-height:\s*2\.5rem/u,
    "Compact Summary onboarding fields should still keep selects and inputs aligned"
  );
});

test("does not block the whole provider config dialog on hosted API keys", () => {
  assert.match(source, /isHostApiKeysLoading/u, "ProviderConfigDialog should track hosted API key loading separately");
  assert.ok(source.includes('void apiFetch("/api/host/api-keys"'), "Hosted API key loading should be launched without blocking config forms");
  assert.match(source, /hostApiKeysLoading/u, "Hosted API key selects should have a loading placeholder");
});

test("keeps provider tab labels intact on narrow screens", () => {
  assert.match(cssRule(".provider-config-tab__copy strong"), /overflow-wrap:\s*normal/u, "Provider tab titles should not split Latin words");
  assert.match(cssRule(".provider-config-tab__copy strong"), /word-break:\s*keep-all/u, "Provider tab titles should keep Agent and OpenAI intact");
  assert.match(cssRule(".provider-config-tab__copy span"), /text-overflow:\s*ellipsis/u, "Provider tab subtitles should truncate instead of breaking words");
  assert.match(cssRule(".provider-config-tab__copy span"), /white-space:\s*nowrap/u, "Provider tab subtitles should stay on one line");
  assert.match(
    styles,
    /@media \(max-width:\s*480px\)[\s\S]*?\.provider-config-tab\s*\{[^}]*grid-template-columns:\s*1fr;/u,
    "Mobile provider tabs should stack the icon above the complete primary label"
  );
  assert.match(
    styles,
    /@media \(max-width:\s*480px\)[\s\S]*?\.provider-config-tab__copy span\s*\{[^}]*display:\s*none;/u,
    "Mobile provider tabs should hide secondary copy before truncating the primary label"
  );
});

test("keeps the compact desktop close target usable", () => {
  assert.match(
    styles,
    /@media \(min-width:\s*1180px\)[\s\S]*?\.provider-config-dialog__close\s*\{[^}]*width:\s*2\.5rem;[^}]*height:\s*2\.5rem;/u,
    "Provider config close target should remain at least 40 by 40 pixels on desktop"
  );
});

test("shows the complete default resolution model below empty narrow fields", () => {
  assert.match(source, /className="provider-resolution-model__fallback"/u, "Empty resolution model fields should render a visible fallback label");
  assert.match(source, /localForm\.model4K \? null : \(/u, "The 4K fallback label should only render while the field is empty");
  assert.match(styles, /\.provider-resolution-model__fallback\s*\{[^}]*display:\s*block;/u, "The complete fallback label should stay visible on narrow screens");
  assert.match(
    styles,
    /@media \(min-width:\s*1180px\)[\s\S]*?\.provider-resolution-model__fallback\s*\{[^}]*display:\s*none;/u,
    "The duplicate fallback label should stay hidden when the desktop select can show the full value"
  );
});

test("keeps hosted recovery instructions as semantic phrases on narrow screens", () => {
  assert.match(source, /function HostApiKeysEmptyAlert\(\)/u, "Hosted API key recovery copy should be composed in one shared feature component");
  assert.match(source, /provider-secret-pill__action/u, "Hosted API key recovery action should have a protected semantic phrase");
  assert.match(cssRule(".provider-secret-pill__action"), /white-space:\s*nowrap/u, "Hosted API key recovery action should not split into an orphaned CJK word");
  assert.doesNotMatch(cssRule(".provider-secret-pill"), /overflow-wrap:\s*anywhere/u, "Hosted API key alerts should not force arbitrary word breaks");
  assert.match(canvasSource, /canvas-host-session-state__action/u, "Canvas host-session recovery should protect the complete sign-in action");
  assert.match(canvasStyles, /\.canvas-host-session-state__action\s*\{[^}]*white-space:\s*nowrap/u, "Canvas host-session recovery action should not split at mobile widths");
  assert.match(i18nSource, /hostApiKeysEmptyAction:\s*"请先在 AI Cove 创建 API Key"/u, "Chinese API key recovery copy should expose a semantic action phrase");
  assert.match(i18nSource, /hostSessionRequiredRetryAction:\s*"请重新登录"/u, "Chinese host-session recovery copy should expose a semantic action phrase");
});

test("keeps background content inert while the provider dialog is open", () => {
  assert.match(modalFocusSource, /element\.inert = true/u, "Modal focus management should make background roots non-interactive");
  assert.match(modalFocusSource, /document\.addEventListener\("focusin"/u, "Modal focus management should recover focus if it escapes programmatically");
  assert.doesNotMatch(
    modalFocusSource,
    /activeElement instanceof HTMLElement && !dialog\.contains\(activeElement\)\) \{\s*return;/u,
    "Modal keyboard handling should not silently ignore Escape or Tab after focus leaves the dialog"
  );
});

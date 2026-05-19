import assert from "node:assert/strict";

import { generationSubmitActionForProviderState, shouldAutoOpenProviderOnboarding } from "./provider-onboarding.js";

assert.equal(
  shouldAutoOpenProviderOnboarding({
    authProvider: "none",
    dismissedInPageSession: false,
    isProviderConfigDialogOpen: false,
    isAuthLoading: false,
    route: "canvas"
  }),
  true,
  "opens onboarding on the canvas route when no generation provider is configured"
);

assert.equal(
  shouldAutoOpenProviderOnboarding({
    authProvider: "none",
    dismissedInPageSession: true,
    isProviderConfigDialogOpen: false,
    isAuthLoading: false,
    route: "canvas"
  }),
  false,
  "does not reopen onboarding after dismissal in the same page session"
);

assert.equal(
  shouldAutoOpenProviderOnboarding({
    authProvider: "openai",
    dismissedInPageSession: false,
    isProviderConfigDialogOpen: false,
    isAuthLoading: false,
    route: "canvas"
  }),
  false,
  "does not open onboarding when an OpenAI-compatible provider is already available"
);

assert.equal(
  shouldAutoOpenProviderOnboarding({
    authProvider: "codex",
    dismissedInPageSession: false,
    isProviderConfigDialogOpen: false,
    isAuthLoading: false,
    route: "canvas"
  }),
  false,
  "does not open onboarding when Codex is already available"
);

assert.equal(
  shouldAutoOpenProviderOnboarding({
    authProvider: "none",
    dismissedInPageSession: false,
    isProviderConfigDialogOpen: false,
    isAuthLoading: false,
    route: "home"
  }),
  false,
  "only opens onboarding on the canvas route"
);

assert.equal(
  shouldAutoOpenProviderOnboarding({
    authProvider: null,
    dismissedInPageSession: false,
    isProviderConfigDialogOpen: false,
    isAuthLoading: true,
    route: "canvas"
  }),
  false,
  "waits for auth status loading to finish"
);

assert.equal(
  shouldAutoOpenProviderOnboarding({
    authProvider: "none",
    dismissedInPageSession: false,
    isProviderConfigDialogOpen: true,
    isAuthLoading: false,
    route: "canvas"
  }),
  false,
  "does not switch an already-open settings dialog into onboarding"
);

assert.equal(
  generationSubmitActionForProviderState({
    authProvider: "none",
    isAuthLoading: false
  }),
  "configure-image-model",
  "shows the model configuration action after auth finishes with no generation provider"
);

assert.equal(
  generationSubmitActionForProviderState({
    authProvider: "openai",
    isAuthLoading: false
  }),
  "generate",
  "keeps the generate action when an OpenAI-compatible provider is configured"
);

assert.equal(
  generationSubmitActionForProviderState({
    authProvider: "codex",
    isAuthLoading: false
  }),
  "generate",
  "keeps the generate action when Codex image generation is configured"
);

assert.equal(
  generationSubmitActionForProviderState({
    authProvider: null,
    isAuthLoading: true
  }),
  "generate",
  "does not switch actions before auth status finishes loading"
);

process.stdout.write("provider-onboarding.smoke.ts passed\n");

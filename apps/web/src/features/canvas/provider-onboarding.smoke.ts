import assert from "node:assert/strict";

import { shouldAutoOpenProviderOnboarding } from "./provider-onboarding.js";

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

process.stdout.write("provider-onboarding.smoke.ts passed\n");

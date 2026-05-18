import assert from "node:assert/strict";

import { onboardingProviderFieldStates, onboardingRequiredFieldStates } from "./provider-onboarding-fields.js";

assert.deepEqual(
  onboardingRequiredFieldStates({
    apiKey: "",
    baseUrl: "   ",
    model: ""
  }),
  {
    apiKey: "missing",
    baseUrl: "missing",
    model: "missing"
  },
  "empty onboarding fields are marked missing"
);

assert.deepEqual(
  onboardingRequiredFieldStates({
    apiKey: "sk-test",
    baseUrl: "https://api.example.com/v1",
    model: "gpt-image-2"
  }),
  {
    apiKey: "filled",
    baseUrl: "filled",
    model: "filled"
  },
  "filled onboarding fields are marked filled"
);

assert.deepEqual(
  onboardingProviderFieldStates({
    agent: {
      apiKey: "sk-agent",
      baseUrl: "https://api.example.com/v1",
      model: "gpt-5.1-mini"
    },
    image: {
      apiKey: "",
      baseUrl: "   ",
      model: "gpt-image-2"
    }
  }),
  {
    agent: {
      apiKey: "filled",
      baseUrl: "filled",
      model: "filled"
    },
    image: {
      apiKey: "missing",
      baseUrl: "missing",
      model: "filled"
    }
  },
  "onboarding states cover image and Agent model configuration fields"
);

process.stdout.write("provider-onboarding-fields.smoke.ts passed\n");

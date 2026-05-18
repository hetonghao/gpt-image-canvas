import assert from "node:assert/strict";

import { shouldSaveAgentConfig } from "./provider-config-save.js";

const emptyAgentForm = {
  apiKey: "",
  apiKeyId: "",
  baseUrl: "",
  model: "",
  supportsVision: true
};

assert.equal(
  shouldSaveAgentConfig({
    form: emptyAgentForm,
    hasSavedApiKey: false,
    isAiCoveMode: false,
    queryBaseUrlSeed: ""
  }),
  false,
  "does not require Agent config when only the default supportsVision value is present"
);

assert.equal(
  shouldSaveAgentConfig({
    form: {
      ...emptyAgentForm,
      model: "gpt-5.1-mini"
    },
    hasSavedApiKey: false,
    isAiCoveMode: false,
    queryBaseUrlSeed: ""
  }),
  true,
  "saves Agent config when an Agent model is provided"
);

assert.equal(
  shouldSaveAgentConfig({
    form: {
      ...emptyAgentForm,
      apiKeyId: "host-key-1"
    },
    hasSavedApiKey: false,
    isAiCoveMode: true,
    queryBaseUrlSeed: ""
  }),
  true,
  "saves AI Cove Agent config when a host API key is selected"
);

process.stdout.write("provider-config-save.smoke.ts passed\n");

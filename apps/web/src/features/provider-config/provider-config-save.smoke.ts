import test from "node:test";
import assert from "node:assert/strict";

import { AI_COVE_DEFAULT_AGENT_MODEL, getProviderConfigSaveIssueTab, shouldSaveAgentConfig } from "./provider-config-save.js";

test("does not require Agent config when only the default supportsVision value is present", () => {
  assert.equal(
    shouldSaveAgentConfig({
      form: {
        apiKey: "",
        apiKeyId: "",
        baseUrl: "",
        model: "",
        supportsVision: true
      },
      hasSavedApiKey: false,
      isAiCoveMode: false,
      queryBaseUrlSeed: ""
    }),
    false
  );
});

test("saves Agent config when an Agent model is provided", () => {
  assert.equal(
    shouldSaveAgentConfig({
      form: {
        apiKey: "",
        apiKeyId: "",
        baseUrl: "",
        model: AI_COVE_DEFAULT_AGENT_MODEL,
        supportsVision: true
      },
      hasSavedApiKey: false,
      isAiCoveMode: false,
      queryBaseUrlSeed: ""
    }),
    true
  );
});

test("uses gpt-5.4-mini as the AI Cove Agent default model", () => {
  assert.equal(AI_COVE_DEFAULT_AGENT_MODEL, "gpt-5.4-mini");
});

test("saves AI Cove Agent config when a host API key is selected", () => {
  assert.equal(
    shouldSaveAgentConfig({
      form: {
        apiKey: "",
        apiKeyId: "host-key-1",
        baseUrl: "",
        model: "",
        supportsVision: true
      },
      hasSavedApiKey: false,
      isAiCoveMode: true,
      queryBaseUrlSeed: ""
    }),
    true
  );
});

test("switches to the Agent tab when AI Cove Agent config still needs an API key", () => {
  assert.equal(
    getProviderConfigSaveIssueTab({
      agentApiKeyId: "",
      isAiCoveMode: true,
      shouldPersistAgentConfig: true
    }),
    "agent"
  );
});

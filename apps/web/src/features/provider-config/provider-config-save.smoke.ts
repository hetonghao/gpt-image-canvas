import test from "node:test";
import assert from "node:assert/strict";

import {
  AI_COVE_DEFAULT_AGENT_MODEL,
  getProviderConfigSaveIssueTab,
  resolveSummaryModelApiKeyId,
  shouldSaveAgentConfig,
  summaryConfigSaveIntent
} from "./provider-config-save.js";

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

test("skips Summary config when optional fields are empty", () => {
  assert.equal(
    summaryConfigSaveIntent({
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
    "skip"
  );
});

test("saves Summary config when a Gemini model is provided", () => {
  assert.equal(
    summaryConfigSaveIntent({
      form: {
        apiKey: "sk-summary",
        apiKeyId: "",
        baseUrl: "",
        model: "gemini-2.5-flash",
        supportsVision: true
      },
      hasSavedApiKey: false,
      isAiCoveMode: false,
      queryBaseUrlSeed: ""
    }),
    "save"
  );
});

test("clears saved Summary config when all editable fields are blank", () => {
  assert.equal(
    summaryConfigSaveIntent({
      form: {
        apiKey: "",
        apiKeyId: "",
        baseUrl: "",
        model: "",
        supportsVision: true
      },
      hasSavedApiKey: true,
      isAiCoveMode: false,
      queryBaseUrlSeed: ""
    }),
    "clear"
  );
});

test("switches to the Summary tab when AI Cove Summary config still needs an API key", () => {
  assert.equal(
    getProviderConfigSaveIssueTab({
      agentApiKeyId: "agent-key",
      isAiCoveMode: true,
      shouldPersistAgentConfig: true,
      shouldPersistSummaryConfig: true,
      summaryApiKeyId: ""
    }),
    "summary"
  );
});

test("keeps the same Summary model list key when explicit Summary key matches the inherited Agent key", () => {
  const inheritedKey = resolveSummaryModelApiKeyId({
    agentApiKeyId: "host-key-1",
    firstHostApiKeyId: "",
    imageApiKeyId: "",
    summaryApiKeyId: ""
  });
  const explicitKey = resolveSummaryModelApiKeyId({
    agentApiKeyId: "host-key-1",
    firstHostApiKeyId: "",
    imageApiKeyId: "",
    summaryApiKeyId: "host-key-1"
  });

  assert.equal(inheritedKey, "host-key-1");
  assert.equal(explicitKey, inheritedKey);
});

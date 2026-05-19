export interface AgentConfigSaveForm {
  apiKey: string;
  apiKeyId: string;
  baseUrl: string;
  model: string;
  supportsVision: boolean;
}

export const AI_COVE_DEFAULT_AGENT_MODEL = "gpt-5.4-mini";

export type ProviderConfigTab = "image" | "agent";

export function shouldSaveAgentConfig({
  form,
  hasSavedApiKey,
  isAiCoveMode,
  queryBaseUrlSeed
}: {
  form: AgentConfigSaveForm;
  hasSavedApiKey: boolean;
  isAiCoveMode: boolean;
  queryBaseUrlSeed: string;
}): boolean {
  const baseUrl = form.baseUrl.trim();
  if (isAiCoveMode) {
    return Boolean(form.apiKeyId.trim() || form.model.trim());
  }

  return Boolean(hasSavedApiKey || form.apiKey.trim() || (baseUrl && baseUrl !== queryBaseUrlSeed) || form.model.trim());
}

export function getProviderConfigSaveIssueTab({
  agentApiKeyId,
  isAiCoveMode,
  shouldPersistAgentConfig
}: {
  agentApiKeyId: string;
  isAiCoveMode: boolean;
  shouldPersistAgentConfig: boolean;
}): ProviderConfigTab | null {
  if (isAiCoveMode && shouldPersistAgentConfig && !agentApiKeyId.trim()) {
    return "agent";
  }

  return null;
}

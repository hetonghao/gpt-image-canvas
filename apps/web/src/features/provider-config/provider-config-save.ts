export interface AgentConfigSaveForm {
  apiKey: string;
  apiKeyId: string;
  baseUrl: string;
  model: string;
  supportsVision: boolean;
}

export interface SummaryConfigSaveForm {
  apiKey: string;
  apiKeyId: string;
  baseUrl: string;
  model: string;
  supportsVision: boolean;
}

export const AI_COVE_DEFAULT_AGENT_MODEL = "gpt-5.4-mini";

export type ProviderConfigTab = "image" | "agent" | "summary";
export type SummaryConfigSaveIntent = "skip" | "save" | "clear";

export function resolveSummaryModelApiKeyId({
  agentApiKeyId,
  firstHostApiKeyId,
  imageApiKeyId,
  summaryApiKeyId
}: {
  agentApiKeyId: string;
  firstHostApiKeyId: string;
  imageApiKeyId: string;
  summaryApiKeyId: string;
}): string {
  return summaryApiKeyId || agentApiKeyId || imageApiKeyId || firstHostApiKeyId || "";
}

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
  shouldPersistAgentConfig,
  shouldPersistSummaryConfig,
  summaryApiKeyId
}: {
  agentApiKeyId: string;
  isAiCoveMode: boolean;
  shouldPersistAgentConfig: boolean;
  shouldPersistSummaryConfig?: boolean;
  summaryApiKeyId?: string;
}): ProviderConfigTab | null {
  if (isAiCoveMode && shouldPersistAgentConfig && !agentApiKeyId.trim()) {
    return "agent";
  }

  if (isAiCoveMode && shouldPersistSummaryConfig && !summaryApiKeyId?.trim()) {
    return "summary";
  }

  return null;
}

export function summaryConfigSaveIntent({
  form,
  hasSavedApiKey,
  isAiCoveMode,
  queryBaseUrlSeed
}: {
  form: SummaryConfigSaveForm;
  hasSavedApiKey: boolean;
  isAiCoveMode: boolean;
  queryBaseUrlSeed: string;
}): SummaryConfigSaveIntent {
  const apiKey = isAiCoveMode ? form.apiKeyId.trim() : form.apiKey.trim();
  const model = form.model.trim();
  const baseUrl = form.baseUrl.trim();

  if (!apiKey && !model && !baseUrl && hasSavedApiKey) {
    return "clear";
  }

  if (isAiCoveMode) {
    return apiKey || model ? "save" : "skip";
  }

  return hasSavedApiKey || apiKey || model || (baseUrl && baseUrl !== queryBaseUrlSeed) ? "save" : "skip";
}

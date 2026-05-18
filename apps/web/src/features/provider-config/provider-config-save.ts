export interface AgentConfigSaveForm {
  apiKey: string;
  apiKeyId: string;
  baseUrl: string;
  model: string;
  supportsVision: boolean;
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

import { and, eq, isNull, or } from "drizzle-orm";
import {
  IMAGE_MODEL,
  PROVIDER_SOURCE_IDS,
  type CodexAuthSessionView,
  type LocalOpenAIProviderConfigView,
  type MaskedSecret,
  type ProviderConfigResponse,
  type ProviderSourceId,
  type ProviderSourceSummary,
  type ProviderSourceView,
  type RuntimeImageProvider,
  type SaveLocalOpenAIProviderConfig,
  type SaveProviderConfigRequest
} from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import {
  DEFAULT_OPENAI_IMAGE_TIMEOUT_MS,
  getConfiguredImageModel,
  parseOpenAIImageTimeoutMs,
  type OpenAIImageProviderConfig
} from "../../infrastructure/providers/image-provider.js";
import { codexOAuthTokens, providerConfigs } from "../../infrastructure/schema.js";
import {
  hostGatewayBaseUrl,
  hostGatewayRuntimeBaseUrl,
  isHostedAiCoveMode,
  listHostApiKeys,
  resolveHostApiKey,
  type HostApiKeyRecord,
  type HostContext
} from "../host/host-adapter.js";

const ACTIVE_PROVIDER_CONFIG_ID = "active";
const CODEX_TOKEN_ROW_ID = "default";

export const DEFAULT_PROVIDER_SOURCE_ORDER: ProviderSourceId[] = ["env-openai", "local-openai", "codex"];

type ProviderConfigRow = typeof providerConfigs.$inferSelect;
type CodexTokenRow = typeof codexOAuthTokens.$inferSelect;

interface ResolvedLocalConfig {
  localApiKey: string | null;
  localApiKeyId: string | null;
  localBaseUrl: string | null;
  localModel: string | null;
  localTimeoutMs: number | null;
}

export async function getProviderConfig(hostContext?: HostContext, signal?: AbortSignal): Promise<ProviderConfigResponse> {
  if (isHostedAiCoveMode()) {
    return getProviderConfigWithSeed(undefined, hostContext, signal);
  }

  return getProviderConfigWithSeed(undefined, hostContext);
}

export async function getProviderConfigWithSeed(
  baseUrlSeed?: string,
  hostContext?: HostContext,
  signal?: AbortSignal
): Promise<ProviderConfigResponse> {
  const row = getProviderConfigRowWithSeed(baseUrlSeed, hostContext);
  const hostApiKeys = await hostApiKeysForConfig(hostContext, signal);
  const sourceOrder = readSavedSourceOrder(row?.sourceOrderJson);
  const sourcesById = new Map(providerSources(row, hostContext, hostApiKeys).map((source) => [source.id, source]));
  const sources = sourceOrder.map((sourceId) => sourcesById.get(sourceId)).filter(isDefined);
  const activeSource = sources.find((source) => source.available);

  return {
    sourceOrder,
    sources,
    localOpenAI: localOpenAIConfigView(row, hostApiKeys),
    activeSource: activeSource ? providerSourceSummary(activeSource) : undefined
  };
}

export async function saveProviderConfig(
  input: SaveProviderConfigRequest,
  hostContext?: HostContext,
  signal?: AbortSignal
): Promise<ProviderConfigResponse> {
  if (!isProviderSourceOrder(input.sourceOrder)) {
    throw new Error("Provider source order is invalid.");
  }

  const now = new Date().toISOString();
  const existing = getProviderConfigRow(hostContext);
  const local = resolveLocalConfigForSave(input.localOpenAI, existing);
  if (isHostedAiCoveMode() && local.localApiKeyId) {
    await assertHostApiKeyAvailable(hostContext, local.localApiKeyId, signal);
  }

  const row: ProviderConfigRow = {
    id: scopedSingletonId(ACTIVE_PROVIDER_CONFIG_ID, hostContext),
    userId: hostUserId(hostContext),
    sourceOrderJson: JSON.stringify(input.sourceOrder),
    localApiKey: local.localApiKey,
    localApiKeyId: local.localApiKeyId,
    localBaseUrl: local.localBaseUrl,
    localModel: local.localModel,
    localTimeoutMs: local.localTimeoutMs,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  db.insert(providerConfigs)
    .values(row)
    .onConflictDoUpdate({
      target: providerConfigs.id,
      set: {
        sourceOrderJson: row.sourceOrderJson,
        localApiKey: row.localApiKey,
        localApiKeyId: row.localApiKeyId,
        localBaseUrl: row.localBaseUrl,
        localModel: row.localModel,
        localTimeoutMs: row.localTimeoutMs,
        updatedAt: row.updatedAt
      }
    })
    .run();

  return getProviderConfig(hostContext, signal);
}

export function getProviderSourceOrder(hostContext?: HostContext): ProviderSourceId[] {
  return readSavedSourceOrder(getProviderConfigRow(hostContext)?.sourceOrderJson);
}

export function getEnvironmentOpenAIImageProviderConfig(): OpenAIImageProviderConfig | undefined {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return undefined;
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  return {
    apiKey,
    baseURL: baseURL || undefined,
    model: getConfiguredImageModel(),
    timeoutMs: parseOpenAIImageTimeoutMs(process.env.OPENAI_IMAGE_TIMEOUT_MS)
  };
}

export async function getLocalOpenAIImageProviderConfig(
  hostContext?: HostContext,
  signal?: AbortSignal
): Promise<OpenAIImageProviderConfig | undefined> {
  const row = getProviderConfigRow(hostContext);
  const apiKey =
    isHostedAiCoveMode() && row?.localApiKeyId
      ? await resolveHostApiKey(requireHostContextForAiCove(hostContext), row.localApiKeyId, signal)
      : trimToUndefined(row?.localApiKey);
  if (!apiKey) {
    return undefined;
  }

  return {
    apiKey,
    baseURL: isHostedAiCoveMode() ? hostGatewayRuntimeBaseUrl() : trimToUndefined(row?.localBaseUrl),
    model: trimToUndefined(row?.localModel) ?? IMAGE_MODEL,
    timeoutMs: validTimeoutMs(row?.localTimeoutMs) ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS
  };
}

export function isProviderSourceOrder(value: unknown): value is ProviderSourceId[] {
  return parseProviderSourceOrder(value) !== undefined;
}

export function isProviderSourceId(value: unknown): value is ProviderSourceId {
  return typeof value === "string" && (PROVIDER_SOURCE_IDS as readonly string[]).includes(value);
}

function getProviderConfigRow(hostContext?: HostContext): ProviderConfigRow | undefined {
  return db.select().from(providerConfigs).where(eq(providerConfigs.id, scopedSingletonId(ACTIVE_PROVIDER_CONFIG_ID, hostContext))).get();
}

function getProviderConfigRowWithSeed(baseUrlSeed?: string, hostContext?: HostContext): ProviderConfigRow | undefined {
  const row = getProviderConfigRow(hostContext);
  if (isHostedAiCoveMode()) {
    return row;
  }

  const normalizedBaseUrlSeed = normalizeProviderBaseUrlSeed(baseUrlSeed);
  const rawLocalBaseUrl = trimToUndefined(row?.localBaseUrl);
  const currentLocalBaseUrl = normalizeProviderBaseUrlSeed(rawLocalBaseUrl);

  if (!normalizedBaseUrlSeed) {
    return row;
  }

  const now = new Date().toISOString();
  if (!row) {
    const seededRow: ProviderConfigRow = {
      id: ACTIVE_PROVIDER_CONFIG_ID,
      userId: hostUserId(hostContext),
      sourceOrderJson: JSON.stringify(DEFAULT_PROVIDER_SOURCE_ORDER),
      localApiKey: null,
      localApiKeyId: null,
      localBaseUrl: normalizedBaseUrlSeed,
      localModel: null,
      localTimeoutMs: null,
      createdAt: now,
      updatedAt: now
    };
    db.insert(providerConfigs).values(seededRow).onConflictDoNothing().run();
    return getProviderConfigRow(hostContext);
  }

  if (rawLocalBaseUrl && currentLocalBaseUrl === normalizedBaseUrlSeed && rawLocalBaseUrl !== currentLocalBaseUrl) {
    db.update(providerConfigs)
      .set({
        localBaseUrl: normalizedBaseUrlSeed,
        updatedAt: now
      })
      .where(
        and(
          eq(providerConfigs.id, scopedSingletonId(ACTIVE_PROVIDER_CONFIG_ID, hostContext)),
          eq(providerConfigs.localBaseUrl, rawLocalBaseUrl)
        )
      )
      .run();
    return getProviderConfigRow(hostContext);
  }

  if (currentLocalBaseUrl) {
    return row;
  }

  db.update(providerConfigs)
    .set({
      localBaseUrl: normalizedBaseUrlSeed,
      updatedAt: now
    })
    .where(
      and(
      eq(providerConfigs.id, scopedSingletonId(ACTIVE_PROVIDER_CONFIG_ID, hostContext)),
        or(isNull(providerConfigs.localBaseUrl), eq(providerConfigs.localBaseUrl, ""))
      )
    )
    .run();
  return getProviderConfigRow(hostContext);
}

function normalizeProviderBaseUrlSeed(value: string | null | undefined): string | undefined {
  const trimmed = trimToUndefined(value);
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/u, "");
    url.pathname = pathname.endsWith("/v1") ? pathname : `${pathname}/v1`;
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/u, "");
  } catch {
    return trimmed;
  }
}

function providerSources(
  row: ProviderConfigRow | undefined,
  hostContext: HostContext | undefined,
  hostApiKeys: HostApiKeyRecord[] | undefined
): ProviderSourceView[] {
  const envConfig = getEnvironmentOpenAIImageProviderConfig();
  const hasLocalConfig =
    isHostedAiCoveMode()
      ? Boolean(findHostApiKeyRecord(row?.localApiKeyId, hostApiKeys))
      : Boolean(trimToUndefined(row?.localApiKey));
  const codex = codexSessionView(getCodexTokenRow(hostContext));

  return [
    {
      id: "env-openai",
      kind: "environment",
      label: "Environment OpenAI API",
      available: Boolean(envConfig),
      status: envConfig ? "available" : "missing_api_key",
      details: {
        baseUrl: process.env.OPENAI_BASE_URL?.trim() || "",
        model: getConfiguredImageModel(),
        timeoutMs: parseOpenAIImageTimeoutMs(process.env.OPENAI_IMAGE_TIMEOUT_MS)
      },
      secret: maskedSecret(process.env.OPENAI_API_KEY)
    },
    {
      id: "local-openai",
      kind: "local",
      label: "Custom OpenAI-compatible API",
      available: hasLocalConfig,
      status: hasLocalConfig ? "available" : "missing_api_key",
      details: {
        baseUrl: isHostedAiCoveMode() ? hostGatewayBaseUrl() : (row?.localBaseUrl ?? ""),
        model: trimToUndefined(row?.localModel) ?? IMAGE_MODEL,
        timeoutMs: validTimeoutMs(row?.localTimeoutMs) ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS
      },
      secret: isHostedAiCoveMode() ? { hasSecret: Boolean(row?.localApiKeyId) } : maskedSecret(row?.localApiKey)
    },
    {
      id: "codex",
      kind: "codex",
      label: "Codex",
      available: codex.available,
      status: codex.available ? "available" : "missing_codex_session",
      details: {
        codex
      },
      secret: {
        hasSecret: false
      }
    }
  ];
}

function localOpenAIConfigView(row: ProviderConfigRow | undefined, hostApiKeys: HostApiKeyRecord[] | undefined): LocalOpenAIProviderConfigView {
  const hasHostApiKey = Boolean(findHostApiKeyRecord(row?.localApiKeyId, hostApiKeys));
  return {
    apiKey: isHostedAiCoveMode() ? { hasSecret: hasHostApiKey } : maskedSecret(row?.localApiKey),
    apiKeyId: row?.localApiKeyId ?? undefined,
    baseUrl: isHostedAiCoveMode() ? hostGatewayBaseUrl() : (row?.localBaseUrl ?? ""),
    model: trimToUndefined(row?.localModel) ?? IMAGE_MODEL,
    timeoutMs: validTimeoutMs(row?.localTimeoutMs) ?? DEFAULT_OPENAI_IMAGE_TIMEOUT_MS
  };
}

function providerSourceSummary(source: ProviderSourceView): ProviderSourceSummary {
  return {
    id: source.id,
    kind: source.kind,
    label: source.label,
    provider: runtimeProviderForSource(source.id),
    available: source.available,
    status: source.status
  };
}

function runtimeProviderForSource(sourceId: ProviderSourceId): RuntimeImageProvider {
  if (sourceId === "codex") {
    return "codex";
  }

  return "openai";
}

function resolveLocalConfigForSave(
  input: SaveLocalOpenAIProviderConfig | undefined,
  existing: ProviderConfigRow | undefined
): ResolvedLocalConfig {
  if (!input) {
    return {
      localApiKey: existing?.localApiKey ?? null,
      localApiKeyId: existing?.localApiKeyId ?? null,
      localBaseUrl: existing?.localBaseUrl ?? null,
      localModel: existing?.localModel ?? null,
      localTimeoutMs: existing?.localTimeoutMs ?? null
    };
  }

  return {
    localApiKey: isHostedAiCoveMode() ? null : resolveLocalApiKey(input, existing),
    localApiKeyId: isHostedAiCoveMode() ? (trimToNull(input.apiKeyId) ?? existing?.localApiKeyId ?? null) : (existing?.localApiKeyId ?? null),
    localBaseUrl: isHostedAiCoveMode() ? hostGatewayRuntimeBaseUrl() : Object.hasOwn(input, "baseUrl") ? trimToNull(input.baseUrl) : (existing?.localBaseUrl ?? null),
    localModel: Object.hasOwn(input, "model") ? trimToNull(input.model) : (existing?.localModel ?? null),
    localTimeoutMs: Object.hasOwn(input, "timeoutMs")
      ? requiredPositiveInteger(input.timeoutMs, "Custom OpenAI timeout")
      : (existing?.localTimeoutMs ?? null)
  };
}

function resolveLocalApiKey(input: SaveLocalOpenAIProviderConfig, existing: ProviderConfigRow | undefined): string | null {
  if (typeof input.apiKey === "string") {
    const trimmed = input.apiKey.trim();
    if (trimmed) {
      return trimmed;
    }

    return input.preserveApiKey === true ? (existing?.localApiKey ?? null) : null;
  }

  return existing?.localApiKey ?? null;
}

function requiredPositiveInteger(value: number | undefined, label: string): number | null {
  if (value === undefined) {
    return null;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function readSavedSourceOrder(value: string | undefined): ProviderSourceId[] {
  if (!value) {
    return [...DEFAULT_PROVIDER_SOURCE_ORDER];
  }

  try {
    return parseProviderSourceOrder(JSON.parse(value) as unknown) ?? [...DEFAULT_PROVIDER_SOURCE_ORDER];
  } catch {
    return [...DEFAULT_PROVIDER_SOURCE_ORDER];
  }
}

function parseProviderSourceOrder(value: unknown): ProviderSourceId[] | undefined {
  if (!Array.isArray(value) || value.length !== PROVIDER_SOURCE_IDS.length) {
    return undefined;
  }

  if (!value.every(isProviderSourceId)) {
    return undefined;
  }

  const unique = new Set(value);
  if (unique.size !== PROVIDER_SOURCE_IDS.length) {
    return undefined;
  }

  return PROVIDER_SOURCE_IDS.every((sourceId) => unique.has(sourceId)) ? [...value] : undefined;
}

function getCodexTokenRow(hostContext?: HostContext): CodexTokenRow | undefined {
  return db.select().from(codexOAuthTokens).where(eq(codexOAuthTokens.id, scopedSingletonId(CODEX_TOKEN_ROW_ID, hostContext))).get();
}

function codexSessionView(row: CodexTokenRow | undefined): CodexAuthSessionView {
  const available = hasUsableTokenMaterial(row);

  return {
    available,
    email: row?.email ?? undefined,
    accountId: row?.accountId ?? undefined,
    expiresAt: row?.expiresAt ?? undefined,
    refreshedAt: row?.refreshedAt ?? undefined,
    unavailableReason: !available ? (row?.unavailableReason ?? undefined) : undefined
  };
}

function hasUsableTokenMaterial(row: CodexTokenRow | undefined): row is CodexTokenRow & {
  accessToken: string;
  refreshToken: string;
} {
  return Boolean(row?.accessToken?.trim() && row.refreshToken?.trim() && !row.unavailableAt);
}

function maskedSecret(value: string | null | undefined): MaskedSecret {
  const trimmed = trimToUndefined(value);
  return {
    hasSecret: Boolean(trimmed),
    value: trimmed ? maskSecret(trimmed) : undefined
  };
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 4)}${"*".repeat(Math.min(8, Math.max(4, value.length - 8)))}${value.slice(-4)}`;
}

function trimToUndefined(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function trimToNull(value: string | undefined): string | null {
  return value?.trim() || null;
}

function validTimeoutMs(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

async function hostApiKeysForConfig(hostContext: HostContext | undefined, signal?: AbortSignal): Promise<HostApiKeyRecord[] | undefined> {
  if (!isHostedAiCoveMode()) {
    return undefined;
  }

  return listHostApiKeys(requireHostContextForAiCove(hostContext), signal);
}

async function assertHostApiKeyAvailable(hostContext: HostContext | undefined, apiKeyId: string, signal?: AbortSignal): Promise<void> {
  const key = await resolveHostApiKey(requireHostContextForAiCove(hostContext), apiKeyId, signal);
  if (!key) {
    throw new Error("Selected AI Cove API key is unavailable for the current user.");
  }
}

function findHostApiKeyRecord(apiKeyId: string | null | undefined, hostApiKeys: HostApiKeyRecord[] | undefined): HostApiKeyRecord | undefined {
  const id = apiKeyId?.trim();
  return id ? hostApiKeys?.find((record) => record.summary.id === id) : undefined;
}

function hostUserId(hostContext: HostContext | undefined): string {
  return hostContext?.user.id ?? "standalone";
}

function scopedSingletonId(id: string, hostContext: HostContext | undefined): string {
  const userId = hostUserId(hostContext);
  return userId === "standalone" ? id : `${userId}:${id}`;
}

function requireHostContextForAiCove(hostContext: HostContext | undefined): HostContext {
  if (!hostContext) {
    throw new Error("Host context is required in AI Cove mode.");
  }

  return hostContext;
}

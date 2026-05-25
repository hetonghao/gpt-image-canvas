import { eq } from "drizzle-orm";
import type { MaskedSecret, SaveSummaryLlmConfigRequest, SummaryLlmConfigView } from "../contracts.js";
import { db } from "../../infrastructure/database.js";
import { summaryLlmConfigs } from "../../infrastructure/schema.js";
import {
  hostGatewayBaseUrl,
  hostGatewayRuntimeBaseUrl,
  isHostedAiCoveMode,
  resolveHostApiKey,
  type HostContext
} from "../host/host-adapter.js";

const ACTIVE_SUMMARY_LLM_CONFIG_ID = "active";
export const DEFAULT_SUMMARY_LLM_TIMEOUT_MS = 60000;

type SummaryLlmConfigRow = typeof summaryLlmConfigs.$inferSelect;

export interface UsableSummaryLlmConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  timeoutMs: number;
  supportsVision: boolean;
}

export function getSummaryLlmConfig(hostContext?: HostContext): SummaryLlmConfigView {
  return toSummaryLlmConfigView(getSummaryLlmConfigRow(hostContext));
}

export async function getUsableSummaryLlmConfig(
  hostContext?: HostContext,
  signal?: AbortSignal
): Promise<UsableSummaryLlmConfig | undefined> {
  const row = getSummaryLlmConfigRow(hostContext);
  if (!isSummaryConfigRowConfigured(row)) {
    return undefined;
  }

  const apiKey =
    isHostedAiCoveMode() && row?.apiKeyId
      ? await resolveHostApiKey(requireHostContextForAiCove(hostContext), row.apiKeyId, signal)
      : trimToUndefined(row?.apiKey);
  const model = trimToUndefined(row?.model);
  const timeoutMs = validTimeoutMs(row?.timeoutMs);

  if (!apiKey || !model || !timeoutMs) {
    return undefined;
  }

  return {
    apiKey,
    baseUrl: isHostedAiCoveMode() ? hostGatewayRuntimeBaseUrl() : trimToUndefined(row?.baseUrl),
    model,
    timeoutMs,
    supportsVision: row?.supportsVision === 1
  };
}

export async function saveSummaryLlmConfig(
  input: SaveSummaryLlmConfigRequest,
  hostContext?: HostContext,
  signal?: AbortSignal
): Promise<SummaryLlmConfigView> {
  const now = new Date().toISOString();
  const existing = getSummaryLlmConfigRow(hostContext);
  const wantsClear = isClearRequest(input);
  const wantsConfig = !wantsClear && summaryInputHasConfig(input, existing);

  const row: SummaryLlmConfigRow = wantsConfig
    ? await buildConfiguredSummaryRow(input, existing, now, hostContext, signal)
    : {
        id: scopedSingletonId(ACTIVE_SUMMARY_LLM_CONFIG_ID, hostContext),
        userId: hostUserId(hostContext),
        apiKey: null,
        apiKeyId: null,
        baseUrl: isHostedAiCoveMode() ? hostGatewayRuntimeBaseUrl() : input.baseUrl.trim(),
        model: "",
        timeoutMs: validTimeoutMs(input.timeoutMs) ?? DEFAULT_SUMMARY_LLM_TIMEOUT_MS,
        supportsVision: input.supportsVision ? 1 : 0,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      };

  db.insert(summaryLlmConfigs)
    .values(row)
    .onConflictDoUpdate({
      target: summaryLlmConfigs.id,
      set: {
        apiKey: row.apiKey,
        apiKeyId: row.apiKeyId,
        baseUrl: row.baseUrl,
        model: row.model,
        timeoutMs: row.timeoutMs,
        supportsVision: row.supportsVision,
        updatedAt: row.updatedAt
      }
    })
    .run();

  return getSummaryLlmConfig(hostContext);
}

async function buildConfiguredSummaryRow(
  input: SaveSummaryLlmConfigRequest,
  existing: SummaryLlmConfigRow | undefined,
  now: string,
  hostContext: HostContext | undefined,
  signal: AbortSignal | undefined
): Promise<SummaryLlmConfigRow> {
  const apiKey = isHostedAiCoveMode() ? null : resolveApiKeyForSave(input, existing);
  const apiKeyId = isHostedAiCoveMode()
    ? requiredTrimmedString(input.apiKeyId ?? existing?.apiKeyId ?? "", "Summary LLM API key")
    : (existing?.apiKeyId ?? null);
  const baseUrl = isHostedAiCoveMode() ? hostGatewayRuntimeBaseUrl() : input.baseUrl.trim();
  const model = requiredTrimmedString(input.model, "Summary LLM model");
  const timeoutMs = requiredPositiveInteger(input.timeoutMs, "Summary LLM timeout");

  if (!isHostedAiCoveMode() && !apiKey) {
    throw new Error("Summary LLM API key is required.");
  }
  if (isHostedAiCoveMode()) {
    const selectedApiKeyId = requiredTrimmedString(apiKeyId ?? "", "Summary LLM API key");
    if (!(await resolveHostApiKey(requireHostContextForAiCove(hostContext), selectedApiKeyId, signal))) {
      throw new Error("Selected AI Cove API key is unavailable for the current user.");
    }
  }

  return {
    id: scopedSingletonId(ACTIVE_SUMMARY_LLM_CONFIG_ID, hostContext),
    userId: hostUserId(hostContext),
    apiKey,
    apiKeyId,
    baseUrl,
    model,
    timeoutMs,
    supportsVision: input.supportsVision ? 1 : 0,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function getSummaryLlmConfigRow(hostContext?: HostContext): SummaryLlmConfigRow | undefined {
  return db.select().from(summaryLlmConfigs).where(eq(summaryLlmConfigs.id, scopedSingletonId(ACTIVE_SUMMARY_LLM_CONFIG_ID, hostContext))).get();
}

function toSummaryLlmConfigView(row: SummaryLlmConfigRow | undefined): SummaryLlmConfigView {
  const timeoutMs = validTimeoutMs(row?.timeoutMs) ?? DEFAULT_SUMMARY_LLM_TIMEOUT_MS;
  const apiKey = trimToUndefined(row?.apiKey);
  const model = row?.model?.trim() ?? "";

  return {
    configured: isSummaryConfigRowConfigured(row),
    apiKey: isHostedAiCoveMode() ? { hasSecret: Boolean(row?.apiKeyId) } : maskedSecret(apiKey),
    apiKeyId: row?.apiKeyId ?? undefined,
    baseUrl: isHostedAiCoveMode() ? hostGatewayBaseUrl() : (row?.baseUrl?.trim() ?? ""),
    model,
    timeoutMs,
    supportsVision: row?.supportsVision === 1,
    createdAt: row?.createdAt ?? "",
    updatedAt: row?.updatedAt ?? ""
  };
}

function isSummaryConfigRowConfigured(row: SummaryLlmConfigRow | undefined): boolean {
  const secretReady = isHostedAiCoveMode() ? Boolean(row?.apiKeyId) : Boolean(trimToUndefined(row?.apiKey));
  return Boolean(secretReady && trimToUndefined(row?.model));
}

function summaryInputHasConfig(input: SaveSummaryLlmConfigRequest, existing: SummaryLlmConfigRow | undefined): boolean {
  return Boolean(
    trimToUndefined(input.apiKey) ||
      trimToUndefined(input.apiKeyId) ||
      trimToUndefined(input.model) ||
      trimToUndefined(input.baseUrl) ||
      (input.preserveApiKey === true && (isHostedAiCoveMode() ? existing?.apiKeyId : trimToUndefined(existing?.apiKey)))
  );
}

function isClearRequest(input: SaveSummaryLlmConfigRequest): boolean {
  return (
    !trimToUndefined(input.apiKey) &&
    !trimToUndefined(input.apiKeyId) &&
    !trimToUndefined(input.model) &&
    !trimToUndefined(input.baseUrl) &&
    input.preserveApiKey !== true
  );
}

function resolveApiKeyForSave(input: SaveSummaryLlmConfigRequest, existing: SummaryLlmConfigRow | undefined): string | null {
  if (typeof input.apiKey === "string") {
    const trimmed = input.apiKey.trim();
    if (trimmed) {
      return trimmed;
    }

    return input.preserveApiKey === true ? (trimToUndefined(existing?.apiKey) ?? null) : null;
  }

  if (input.preserveApiKey === true) {
    return trimToUndefined(existing?.apiKey) ?? null;
  }

  return trimToUndefined(existing?.apiKey) ?? null;
}

function requiredTrimmedString(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function requiredPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
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

function validTimeoutMs(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
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

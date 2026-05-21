import { isHostedAiCoveAdapterMode, type HostApiKeySummary, type HostModelSummary, type HostSessionResponse, type HostUser } from "../contracts.js";
import { hostAdapterConfig } from "../../infrastructure/runtime.js";

const STANDALONE_USER: HostUser = {
  id: "standalone",
  displayName: "Standalone User"
};
const HOST_FETCH_TIMEOUT_MS = 10_000;

export interface HostApiKeyRecord {
  summary: HostApiKeySummary;
  key?: string;
}

export interface HostContext {
  token?: string;
  cookie?: string;
  userId?: string;
  user: HostUser;
}

export type HostResolveResult =
  | {
      ok: true;
      context: HostContext;
    }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
    };

export function hostGatewayBaseUrl(): string {
  return `${hostAdapterConfig.aiCovePublicBaseUrl}/v1`;
}

export function hostGatewayRuntimeBaseUrl(): string {
  return `${hostAdapterConfig.aiCoveApiBaseUrl}/v1`;
}

export function standaloneHostUser(): HostUser {
  return { ...STANDALONE_USER };
}

export function isHostedAiCoveMode(): boolean {
  return isHostedAiCoveAdapterMode(hostAdapterConfig.mode);
}

function isNewApiHostMode(): boolean {
  return hostAdapterConfig.mode === "ai-cove-new-api";
}

export function extractHostToken(input: { authorization?: string | null; token?: string | null }): string | undefined {
  const bearer = input.authorization?.match(/^\s*Bearer\s+(.+?)\s*$/iu)?.[1]?.trim();
  return bearer || input.token?.trim() || undefined;
}

export async function resolveHostContext(input: {
  authorization?: string | null;
  cookie?: string | null;
  token?: string | null;
  userId?: string | null;
  signal?: AbortSignal;
}): Promise<HostResolveResult> {
  if (hostAdapterConfig.mode === "standalone") {
    return {
      ok: true,
      context: {
        user: standaloneHostUser()
      }
    };
  }

  const token = extractHostToken(input);
  const cookie = input.cookie?.trim() || undefined;
  if (!token && !(isNewApiHostMode() && cookie)) {
    return {
      ok: false,
      status: 401,
      code: "host_auth_required",
      message: "AI Cove token is required."
    };
  }

  try {
    const userId = input.userId?.trim();
    if (isNewApiHostMode() && !userId) {
      return {
        ok: false,
        status: 401,
        code: "host_user_required",
        message: "AI Cove user id is required."
      };
    }

    const userPayload = await fetchHostJson(
      isNewApiHostMode() ? "/api/user/self" : "/api/v1/auth/me",
      { token, cookie },
      input.signal,
      isNewApiHostMode() ? { userId } : undefined
    );
    const user = parseHostUser(userPayload);
    if (!user) {
      return {
        ok: false,
        status: 401,
        code: "host_auth_invalid",
        message: "AI Cove token is invalid."
      };
    }

    return {
      ok: true,
      context: {
        token,
        cookie,
        userId: user.id,
        user
      }
    };
  } catch {
    return {
      ok: false,
      status: 401,
      code: "host_auth_invalid",
      message: "AI Cove token could not be verified."
    };
  }
}

export function hostSessionResponse(context: HostContext): HostSessionResponse {
  return {
    adapter: {
      mode: hostAdapterConfig.mode,
      aiCoveApiBaseUrl: hostAdapterConfig.aiCoveApiBaseUrl,
      gatewayBaseUrl: hostGatewayBaseUrl()
    },
    user: context.user
  };
}

export async function listHostApiKeys(context: HostContext, signal?: AbortSignal): Promise<HostApiKeyRecord[]> {
  if (hostAdapterConfig.mode === "standalone") {
    return [];
  }

  if (isNewApiHostMode()) {
    return listNewApiHostTokens(context, signal);
  }

  if (!context.token) {
    return [];
  }

  const payload = await fetchHostJson("/api/v1/keys?page=1&page_size=100", { token: context.token }, signal);
  return parseHostApiKeyItems(payload);
}

export async function resolveHostApiKey(context: HostContext, apiKeyId: string, signal?: AbortSignal): Promise<string | undefined> {
  return (await resolveHostApiKeyRecord(context, apiKeyId, signal))?.key;
}

export async function resolveHostApiKeyRecord(
  context: HostContext,
  apiKeyId: string,
  signal?: AbortSignal
): Promise<HostApiKeyRecord | undefined> {
  const id = apiKeyId.trim();
  if (!id) {
    return undefined;
  }

  const records = await listHostApiKeys(context, signal);
  const record = records.find((candidate) => candidate.summary.id === id);
  if (!record) {
    return undefined;
  }

  if (record.key) {
    return record;
  }

  if (!isNewApiHostMode()) {
    return undefined;
  }

  const userId = context.userId ?? context.user.id;
  const key = await fetchNewApiTokenKey({ token: context.token, cookie: context.cookie }, userId, id, signal);
  return key
    ? {
        summary: {
          ...record.summary,
          maskedKey: maskKey(key) ?? record.summary.maskedKey
        },
        key
      }
    : undefined;
}

export async function listHostModels(context: HostContext, apiKeyId: string, signal?: AbortSignal): Promise<HostModelSummary[]> {
  if (hostAdapterConfig.mode === "standalone") {
    return [];
  }

  const record = await resolveHostApiKeyRecord(context, apiKeyId, signal);
  if (!record?.key) {
    return [];
  }

  const payload = await fetchHostJson("/v1/models", { token: record.key }, signal);
  return parseHostModelItems(payload);
}

async function listNewApiHostTokens(context: HostContext, signal?: AbortSignal): Promise<HostApiKeyRecord[]> {
  if (!context.token && !context.cookie) {
    return [];
  }

  const userId = context.userId ?? context.user.id;
  const auth = { token: context.token, cookie: context.cookie };
  const payload = await fetchHostJson("/api/token/?p=1&size=100", auth, signal, { userId });
  return parseHostApiKeyItems(payload).map((record) => ({
    summary: record.summary
  }));
}

async function fetchNewApiTokenKey(
  auth: HostFetchAuth,
  userId: string,
  tokenId: string,
  signal?: AbortSignal
): Promise<string | undefined> {
  if ((!auth.token && !auth.cookie) || !userId || !tokenId) {
    return undefined;
  }

  const payload = await fetchHostJson(`/api/token/${encodeURIComponent(tokenId)}/key`, auth, signal, {
    method: "POST",
    userId
  });
  return (
    stringValue(recordValue(recordValue(payload, "data"), "key")) ??
    stringValue(recordValue(payload, "key")) ??
    stringValue(recordValue(payload, "data"))
  );
}

type HostFetchAuth = {
  token?: string;
  cookie?: string;
};

async function fetchHostJson(
  path: string,
  auth: HostFetchAuth,
  signal?: AbortSignal,
  options?: {
    method?: string;
    userId?: string;
  }
): Promise<unknown> {
  const timeout = timeoutSignal(signal, HOST_FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    if (auth.token) {
      headers.Authorization = `Bearer ${auth.token}`;
    }
    if (auth.cookie) {
      headers.Cookie = auth.cookie;
    }
    if (options?.userId) {
      headers["New-Api-User"] = options.userId;
    }

    const response = await fetch(`${hostAdapterConfig.aiCoveApiBaseUrl}${path}`, {
      method: options?.method ?? "GET",
      headers,
      signal: timeout.signal
    });

    if (!response.ok) {
      throw new Error(`Host API returned ${response.status}.`);
    }

    return await response.json();
  } finally {
    timeout.cleanup();
  }
}

function parseHostUser(payload: unknown): HostUser | undefined {
  const candidates = [payload, recordValue(payload, "data"), recordValue(recordValue(payload, "data"), "user"), recordValue(payload, "user")];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    const id = scalarStringValue(candidate.id) ?? scalarStringValue(candidate.user_id) ?? scalarStringValue(candidate.userId);
    if (!id) {
      continue;
    }

    return {
      id,
      displayName:
        stringValue(candidate.displayName) ??
        stringValue(candidate.display_name) ??
        stringValue(candidate.name) ??
        stringValue(candidate.username) ??
        stringValue(candidate.email) ??
        id,
      email: stringValue(candidate.email)
    };
  }

  return undefined;
}

function parseHostApiKeyItems(payload: unknown): HostApiKeyRecord[] {
  const rawItems = arrayValue(recordValue(recordValue(payload, "data"), "items")) ?? arrayValue(recordValue(payload, "data")) ?? arrayValue(payload) ?? [];

  return rawItems.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const id = scalarStringValue(item.id);
    if (!id) {
      return [];
    }

    const key = stringValue(item.key) ?? stringValue(item.api_key) ?? stringValue(item.apiKey);
    const quota = recordValue(item, "quota");
    const quotaTotal =
      numberValue(item.quota) ??
      numberValue(item.quota_limit) ??
      numberValue(item.quotaLimit) ??
      numberValue(recordValue(quota, "total")) ??
      numberValue(recordValue(quota, "limit"));
    const quotaUsed =
      numberValue(item.quota_used) ??
      numberValue(item.used_quota) ??
      numberValue(item.quotaUsed) ??
      numberValue(recordValue(quota, "used")) ??
      numberValue(recordValue(quota, "quota_used")) ??
      numberValue(recordValue(quota, "quotaUsed"));
    const quotaRemaining =
      numberValue(item.quota_remaining) ??
      numberValue(item.remain_quota) ??
      numberValue(item.quotaRemaining) ??
      numberValue(recordValue(quota, "remaining")) ??
      numberValue(recordValue(quota, "remain"));

    return [
      {
        summary: {
          id,
          name: stringValue(item.name) ?? id,
          status: scalarStringValue(item.status),
          group: summarizeGroup(item.group),
          quota:
            quotaTotal !== undefined || quotaUsed !== undefined || quotaRemaining !== undefined
              ? {
                  total: quotaTotal,
                  used: quotaUsed,
                  remaining: quotaRemaining
                }
              : undefined,
          maskedKey: maskKey(key)
        },
        key
      }
    ];
  });
}

function parseHostModelItems(payload: unknown): HostModelSummary[] {
  const rawItems = arrayValue(recordValue(payload, "data")) ?? arrayValue(recordValue(recordValue(payload, "data"), "items")) ?? arrayValue(payload) ?? [];
  const seen = new Set<string>();
  const models: HostModelSummary[] = [];

  for (const item of rawItems) {
    const id = isRecord(item) ? (stringValue(item.id) ?? stringValue(item.model) ?? stringValue(item.name)) : stringValue(item);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    models.push({ id });
  }

  return models.sort((left, right) => left.id.localeCompare(right.id));
}

function summarizeGroup(value: unknown): string | undefined {
  if (typeof value === "string") {
    return stringValue(value);
  }

  if (!isRecord(value)) {
    return undefined;
  }

  return stringValue(value.name) ?? stringValue(value.id) ?? stringValue(value.code);
}

function maskKey(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.length <= 10) {
    return "*".repeat(value.length);
  }

  return `${value.slice(0, 6)}${"*".repeat(8)}${value.slice(-4)}`;
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abort();
  } else if (signal) {
    signal.addEventListener("abort", abort, { once: true });
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function scalarStringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

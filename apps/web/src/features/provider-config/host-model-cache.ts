import type { HostModelSummary } from "@gpt-image-canvas/shared";

export type HostModelCacheIdentity = {
  readonly apiKeyId: string;
  readonly gatewayBaseUrl: string;
  readonly userId: string;
};

const modelCache = new Map<string, HostModelSummary[]>();
const requestCache = new Map<string, Promise<HostModelSummary[]>>();

export class HostModelResponseError extends Error {
  constructor() {
    super("Hosted model response is invalid.");
    this.name = "HostModelResponseError";
  }
}

export function createHostModelCacheKey(identity: HostModelCacheIdentity): string {
  return JSON.stringify([identity.userId, identity.gatewayBaseUrl, identity.apiKeyId]);
}

export async function readCachedHostModels(
  identity: HostModelCacheIdentity,
  load: () => Promise<unknown>
): Promise<HostModelSummary[]> {
  const key = createHostModelCacheKey(identity);
  const cached = modelCache.get(key);
  if (cached) {
    return cached;
  }

  const pending = requestCache.get(key);
  if (pending) {
    return pending;
  }

  const request = load()
    .then(parseHostModelItems)
    .then((items) => {
      modelCache.set(key, items);
      return items;
    })
    .finally(() => {
      requestCache.delete(key);
    });
  requestCache.set(key, request);
  return request;
}

export function parseHostModelItems(value: unknown): HostModelSummary[] {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    throw new HostModelResponseError();
  }

  return value.items.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) {
      throw new HostModelResponseError();
    }
    return { id: item.id };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

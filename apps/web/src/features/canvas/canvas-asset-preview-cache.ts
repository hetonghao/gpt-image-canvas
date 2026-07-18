import {
  assetAvailabilityRevision,
  clearAssetAvailability,
  reportAssetAvailability,
  unavailableAssetIds
} from "../../shared/assets/asset-availability";

export interface AssetPreviewCacheOptions {
  readonly fetchImage: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly decodeImage: (blob: Blob) => Promise<boolean>;
  readonly unavailableUrl: string;
  readonly cacheLimit?: number;
  readonly maxConcurrent?: number;
  readonly createObjectUrl?: (blob: Blob) => string;
  readonly revokeObjectUrl?: (url: string) => void;
}

type ResolutionState = "queued" | "pending" | "ready" | "unavailable" | "retired";

interface ResolutionEntry {
  readonly assetId: string;
  readonly sourceUrl: string;
  readonly revision: number;
  readonly lifecycle: number;
  readonly promise: Promise<string>;
  readonly settle: (url: string) => void;
  readonly controller: AbortController;
  objectUrl?: string;
  state: ResolutionState;
}

const DEFAULT_CACHE_LIMIT = 96;
const DEFAULT_MAX_CONCURRENT = 6;

type PreviewDescriptor = {
  readonly identity: string;
  readonly width: number;
};

function previewDescriptor(previewUrl: string): PreviewDescriptor | undefined {
  try {
    const url = new URL(previewUrl, "http://localhost");
    const width = Number(url.searchParams.get("width"));
    if (!Number.isFinite(width) || width <= 0) return undefined;
    url.searchParams.delete("width");
    return {
      identity: `${url.origin}${url.pathname}${url.search}${url.hash}`,
      width
    };
  } catch {
    return undefined;
  }
}

function canReuse(entry: ResolutionEntry, previewUrl: string, revision: number): boolean {
  if (entry.revision !== revision || entry.state === "retired") return false;
  if (entry.sourceUrl === previewUrl) return true;
  const cached = previewDescriptor(entry.sourceUrl);
  const requested = previewDescriptor(previewUrl);
  return cached !== undefined && requested !== undefined && cached.identity === requested.identity && cached.width >= requested.width;
}

export function createAssetPreviewCache(options: AssetPreviewCacheOptions) {
  const cache = new Map<string, ResolutionEntry>();
  const latest = new Map<string, ResolutionEntry>();
  const queue: ResolutionEntry[] = [];
  const objectUrls = new Set<string>();
  const retiredObjectUrls: string[] = [];
  const cacheLimit = Math.max(1, options.cacheLimit ?? DEFAULT_CACHE_LIMIT);
  const maxConcurrent = Math.min(cacheLimit, Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT));
  const entryLimit = cacheLimit + maxConcurrent;
  let activeCount = 0;
  let lifecycle = 0;

  function touch(entry: ResolutionEntry): void {
    if (cache.get(entry.assetId) !== entry) return;
    cache.delete(entry.assetId);
    cache.set(entry.assetId, entry);
  }

  function revokeObjectUrl(url: string): void {
    if (!objectUrls.delete(url)) return;
    options.revokeObjectUrl?.(url);
  }

  function retainRetiredObjectUrl(entry: ResolutionEntry): void {
    if (!entry.objectUrl) return;
    retiredObjectUrls.push(entry.objectUrl);
    entry.objectUrl = undefined;
    while (retiredObjectUrls.length > cacheLimit) {
      const oldestUrl = retiredObjectUrls.shift();
      if (oldestUrl) revokeObjectUrl(oldestUrl);
    }
  }

  function retireEntry(entry: ResolutionEntry): void {
    if (cache.get(entry.assetId) === entry) cache.delete(entry.assetId);
    if (latest.get(entry.assetId) === entry) latest.delete(entry.assetId);
    entry.state = "retired";
    retainRetiredObjectUrl(entry);
  }

  function evictSettledEntry(): boolean {
    for (const [assetId, entry] of cache) {
      if (entry.state === "pending") continue;
      retireEntry(entry);
      return true;
    }
    return false;
  }

  function drainQueue(): void {
    while (activeCount < maxConcurrent && queue.length > 0) {
      while (cache.size >= cacheLimit && evictSettledEntry()) continue;
      if (cache.size >= cacheLimit) return;
      const entry = queue.shift();
      if (!entry) return;
      if (latest.get(entry.assetId) !== entry || assetAvailabilityRevision(entry.assetId) !== entry.revision) {
        retireEntry(entry);
        entry.settle(options.unavailableUrl);
        continue;
      }
      entry.state = "pending";
      cache.set(entry.assetId, entry);
      activeCount += 1;
      void resolveEntry(entry);
    }
  }

  async function resolveEntry(entry: ResolutionEntry): Promise<void> {
    let resolvedUrl = options.unavailableUrl;
    try {
      const response = await options.fetchImage(entry.sourceUrl, { cache: "no-store", signal: entry.controller.signal });
      if (response.ok) {
        const blob = await response.blob();
        if (await options.decodeImage(blob)) {
          resolvedUrl = options.createObjectUrl?.(blob) ?? entry.sourceUrl;
          if (resolvedUrl !== entry.sourceUrl && resolvedUrl !== options.unavailableUrl) {
            if (entry.lifecycle === lifecycle) {
              entry.objectUrl = resolvedUrl;
              objectUrls.add(resolvedUrl);
            }
            else {
              options.revokeObjectUrl?.(resolvedUrl);
              resolvedUrl = options.unavailableUrl;
            }
          }
        }
      }
    } catch {
      resolvedUrl = options.unavailableUrl;
    }
    activeCount -= 1;
    const isLatest =
      latest.get(entry.assetId) === entry &&
      entry.lifecycle === lifecycle &&
      assetAvailabilityRevision(entry.assetId) === entry.revision;
    if (isLatest) {
      entry.state = resolvedUrl === options.unavailableUrl ? "unavailable" : "ready";
      reportAssetAvailability(entry.assetId, entry.sourceUrl, entry.state, entry.revision);
      touch(entry);
    } else {
      retireEntry(entry);
    }
    entry.settle(resolvedUrl);
    drainQueue();
  }

  function retire(assetId: string, abort: boolean): void {
    const entry = latest.get(assetId);
    if (!entry) return;
    const wasQueued = entry.state === "queued";
    const wasPending = entry.state === "pending";
    retireEntry(entry);
    if (wasQueued) {
      const queuedIndex = queue.indexOf(entry);
      if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
      entry.settle(options.unavailableUrl);
    } else if (abort && wasPending) entry.controller.abort();
  }

  function ensureEntryCapacity(): boolean {
    while (latest.size >= entryLimit) {
      let disposableAssetId: string | undefined;
      for (const [assetId, entry] of latest) {
        if (entry.state !== "pending") {
          disposableAssetId = assetId;
          break;
        }
      }
      if (!disposableAssetId) return false;
      retire(disposableAssetId, false);
    }
    return true;
  }

  function resolve(assetId: string, sourceUrl: string): Promise<string> {
    const revision = assetAvailabilityRevision(assetId);
    const existing = latest.get(assetId);
    if (existing && canReuse(existing, sourceUrl, revision)) {
      touch(existing);
      return existing.promise;
    }
    if (existing) retire(assetId, false);
    if (!ensureEntryCapacity()) return Promise.resolve(options.unavailableUrl);
    let settle = (_url: string): void => undefined;
    const promise = new Promise<string>((resolvePromise) => {
      settle = resolvePromise;
    });
    const entry: ResolutionEntry = {
      assetId,
      sourceUrl,
      revision,
      lifecycle,
      promise,
      settle,
      controller: new AbortController(),
      state: "queued"
    };
    latest.set(assetId, entry);
    queue.push(entry);
    drainQueue();
    return promise;
  }

  function retry(assetId?: string): void {
    const assetIds = assetId ? [assetId] : unavailableAssetIds();
    assetIds.forEach((failedAssetId) => {
      invalidate(failedAssetId);
      clearAssetAvailability(failedAssetId);
    });
    drainQueue();
  }

  function invalidate(assetId: string): void {
    retire(assetId, true);
    drainQueue();
  }

  function release(): void {
    lifecycle += 1;
    Array.from(latest.keys()).forEach((assetId) => retire(assetId, true));
    queue.splice(0).forEach((entry) => {
      entry.state = "retired";
      entry.settle(options.unavailableUrl);
    });
    cache.clear();
    latest.clear();
    objectUrls.forEach((url) => options.revokeObjectUrl?.(url));
    objectUrls.clear();
    retiredObjectUrls.length = 0;
  }

  return {
    resolve,
    retry,
    release,
    invalidate,
    cacheSize: () => cache.size,
    entryCount: () => latest.size,
    objectUrlCount: () => objectUrls.size,
    queueSize: () => queue.length
  };
}

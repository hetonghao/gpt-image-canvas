export type AssetAvailability = "ready" | "unavailable";
export type AssetAvailabilityChange = {
  readonly assetId: string;
  readonly type: "report" | "retry";
};

interface AssetAvailabilityEntry {
  readonly revision: number;
  readonly sourceUrl?: string;
  readonly state?: AssetAvailability;
}

type AssetAvailabilityListener = (change: AssetAvailabilityChange) => void;

const ASSET_AVAILABILITY_LIMIT = 192;
const availabilityByAssetId = new Map<string, AssetAvailabilityEntry>();
const listenersByAssetId = new Map<string, Set<AssetAvailabilityListener>>();
const globalListeners = new Set<AssetAvailabilityListener>();
let revisionSequence = 0;
let trimScheduled = false;

function trimAvailability(): void {
  for (const assetId of availabilityByAssetId.keys()) {
    if (availabilityByAssetId.size <= ASSET_AVAILABILITY_LIMIT) return;
    if (!listenersByAssetId.has(assetId)) availabilityByAssetId.delete(assetId);
  }
}

function scheduleAvailabilityTrim(): void {
  if (trimScheduled) return;
  trimScheduled = true;
  queueMicrotask(() => {
    trimScheduled = false;
    trimAvailability();
  });
}

function notifyListeners(change: AssetAvailabilityChange): void {
  globalListeners.forEach((listener) => listener(change));
  listenersByAssetId.get(change.assetId)?.forEach((listener) => listener(change));
}

export function assetAvailabilityRevision(assetId: string): number {
  const current = availabilityByAssetId.get(assetId);
  if (current) {
    return current.revision;
  }

  const revision = ++revisionSequence;
  availabilityByAssetId.set(assetId, { revision });
  scheduleAvailabilityTrim();
  return revision;
}

export function getAssetAvailability(assetId: string): AssetAvailability | undefined {
  return availabilityByAssetId.get(assetId)?.state;
}

export function reportAssetAvailability(
  assetId: string,
  sourceUrl: string,
  state: AssetAvailability,
  revision: number
): void {
  const current = availabilityByAssetId.get(assetId);
  if (!current || current.revision !== revision) {
    return;
  }
  if (current.state === state && current.sourceUrl === sourceUrl) {
    return;
  }

  availabilityByAssetId.delete(assetId);
  availabilityByAssetId.set(assetId, { revision, sourceUrl, state });
  notifyListeners({ assetId, type: "report" });
}

export function clearAssetAvailability(assetId: string): void {
  availabilityByAssetId.delete(assetId);
  availabilityByAssetId.set(assetId, { revision: ++revisionSequence });
  scheduleAvailabilityTrim();
  notifyListeners({ assetId, type: "retry" });
}

export function unavailableAssetIds(): readonly string[] {
  const assetIds: string[] = [];
  for (const [assetId, entry] of availabilityByAssetId) {
    if (entry.state === "unavailable") assetIds.push(assetId);
  }
  return assetIds;
}

export function subscribeAssetAvailability(listener: AssetAvailabilityListener): () => void;
export function subscribeAssetAvailability(assetId: string, listener: AssetAvailabilityListener): () => void;
export function subscribeAssetAvailability(
  assetIdOrListener: string | AssetAvailabilityListener,
  assetListener?: AssetAvailabilityListener
): () => void {
  if (typeof assetIdOrListener === "function") {
    globalListeners.add(assetIdOrListener);
    return () => {
      globalListeners.delete(assetIdOrListener);
    };
  }

  const assetId = assetIdOrListener;
  const listener = assetListener;
  if (!listener) return () => undefined;
  const listeners = listenersByAssetId.get(assetId) ?? new Set<AssetAvailabilityListener>();
  listeners.add(listener);
  listenersByAssetId.set(assetId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByAssetId.delete(assetId);
    trimAvailability();
  };
}

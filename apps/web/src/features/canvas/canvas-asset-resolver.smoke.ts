import assert from "node:assert/strict";
import test from "node:test";
import {
  assetAvailabilityRevision,
  clearAssetAvailability,
  getAssetAvailability,
  reportAssetAvailability,
  subscribeAssetAvailability
} from "../../shared/assets/asset-availability";
import {
  CANVAS_ASSET_UNAVAILABLE_URL,
  createCanvasAssetPreviewResolver
} from "./canvas-asset-resolver";

test("returns and caches a readable canvas preview URL", async () => {
  // Given: the preview endpoint returns an image that the browser can decode.
  let fetchCount = 0;
  const resolver = createCanvasAssetPreviewResolver({
    fetchImage: async () => {
      fetchCount += 1;
      return new Response(new Blob(["readable"]), { status: 200 });
    },
    decodeImage: async () => true
  });

  // When: the canvas resolves the same preview more than once.
  const first = resolver.resolve("readable", "/api/assets/readable/preview?width=1024");
  const second = resolver.resolve("readable", "/api/assets/readable/preview?width=1024");

  // Then: it keeps the real URL and performs the readability check once.
  assert.equal(await first, "/api/assets/readable/preview?width=1024");
  assert.equal(await second, "/api/assets/readable/preview?width=1024");
  assert.equal(fetchCount, 1);
});

test("does not reuse a preview across hosted user credentials", async () => {
  // Given: the same asset id is requested through two user-scoped preview URLs.
  const fetchedUrls: string[] = [];
  const resolver = createCanvasAssetPreviewResolver({
    fetchImage: async (input) => {
      fetchedUrls.push(String(input));
      return new Response(new Blob([String(input)]), { status: 200 });
    },
    decodeImage: async () => true
  });

  // When: the second user asks for a narrower preview of the same asset.
  const firstUrl = "/api/assets/shared/preview?width=1024&token=user-a&user_id=1";
  const secondUrl = "/api/assets/shared/preview?width=512&token=user-b&user_id=2";
  await resolver.resolve("shared", firstUrl);
  const resolved = await resolver.resolve("shared", secondUrl);

  // Then: the resolver performs a new authenticated request instead of reusing the first user's Blob.
  assert.equal(resolved, secondUrl);
  assert.deepEqual(fetchedUrls, [firstUrl, secondUrl]);
});

test("uses the stable placeholder when the preview endpoint fails", async () => {
  // Given: the historical asset no longer has a readable preview.
  let fetchCount = 0;
  const resolver = createCanvasAssetPreviewResolver({
    fetchImage: async () => {
      fetchCount += 1;
      return new Response(null, { status: 404 });
    },
    decodeImage: async () => true
  });

  // When: the canvas resolves the historical asset.
  const previewUrl = "/api/assets/missing/preview?width=1024";
  const resolved = await resolver.resolve("missing", previewUrl);

  // Then: the browser-native broken-image glyph is replaced consistently.
  assert.equal(resolved, CANVAS_ASSET_UNAVAILABLE_URL);
  resolver.retry("missing");
  assert.equal(await resolver.resolve("missing", previewUrl), CANVAS_ASSET_UNAVAILABLE_URL);
  assert.equal(fetchCount, 2, "retry clears the failed cache entry and checks the asset again");
});

test("uses the stable placeholder when the response cannot be decoded", async () => {
  // Given: the endpoint responds, but the body is not a valid image.
  const resolver = createCanvasAssetPreviewResolver({
    fetchImage: async () => new Response(new Blob(["not-an-image"]), { status: 200 }),
    decodeImage: async () => false
  });

  // When: the canvas resolves the corrupt preview.
  const resolved = await resolver.resolve("corrupt", "/api/assets/corrupt/preview?width=1024");

  // Then: the same stable unavailable state is rendered.
  assert.equal(resolved, CANVAS_ASSET_UNAVAILABLE_URL);
});

test("bounds the preview cache to the configured UI working set", async () => {
  // Given: the canvas resolves more historical previews than the cache budget.
  const resolver = createCanvasAssetPreviewResolver({
    cacheLimit: 2,
    fetchImage: async () => new Response(new Blob(["readable"]), { status: 200 }),
    decodeImage: async () => true
  });

  // When: three distinct previews are checked.
  await resolver.resolve("one", "/api/assets/one/preview?width=1024");
  await resolver.resolve("two", "/api/assets/two/preview?width=1024");
  await resolver.resolve("three", "/api/assets/three/preview?width=1024");

  // Then: the resolver evicts the least-recent entry instead of growing forever.
  assert.equal(resolver.cacheSize(), 2);
});

test("keeps the newest successful width authoritative for one asset", async () => {
  // Given: two preview widths for one asset finish out of order.
  const responses = new Map<string, (response: Response) => void>();
  const resolver = createCanvasAssetPreviewResolver({
    fetchImage: (input) =>
      new Promise((resolve) => {
        responses.set(String(input), resolve);
      }),
    decodeImage: async () => true
  });

  // When: the newer wide preview succeeds before the older narrow preview fails.
  const narrow = resolver.resolve("same-asset", "/api/assets/same-asset/preview?width=512");
  const wide = resolver.resolve("same-asset", "/api/assets/same-asset/preview?width=1024");
  responses.get("/api/assets/same-asset/preview?width=1024")?.(new Response(new Blob(["wide"]), { status: 200 }));
  assert.equal(await wide, "/api/assets/same-asset/preview?width=1024");
  responses.get("/api/assets/same-asset/preview?width=512")?.(new Response(null, { status: 404 }));
  assert.equal(await narrow, CANVAS_ASSET_UNAVAILABLE_URL);

  // Then: the stale narrow failure cannot replace the asset-level ready state.
  assert.equal(getAssetAvailability("same-asset"), "ready");
});

test("shared retry invalidates every cached preview width for the asset", async () => {
  // Given: a failed asset preview is cached under its asset id.
  let fetchCount = 0;
  const resolver = createCanvasAssetPreviewResolver({
    fetchImage: async () => {
      fetchCount += 1;
      return new Response(null, { status: 404 });
    },
    decodeImage: async () => true
  });
  await resolver.resolve("retry-shared", "/api/assets/retry-shared/preview?width=512");

  // When: another surface clears the shared asset state and Canvas asks for another width.
  clearAssetAvailability("retry-shared");
  await resolver.resolve("retry-shared", "/api/assets/retry-shared/preview?width=1024");

  // Then: Canvas performs a new request instead of returning the old failed entry.
  assert.equal(fetchCount, 2);
  assert.ok(assetAvailabilityRevision("retry-shared") > 0);
});

test("bounds retained object URLs while preserving one cache-sized grace window", async () => {
  // Given: readable previews use Blob URLs and the cache holds one active plus one retired asset.
  const revoked: string[] = [];
  let objectUrlSequence = 0;
  const resolver = createCanvasAssetPreviewResolver({
    cacheLimit: 1,
    fetchImage: async () => new Response(new Blob(["readable"]), { status: 200 }),
    decodeImage: async () => true,
    createObjectUrl: () => `blob:asset-${++objectUrlSequence}`,
    revokeObjectUrl: (url) => revoked.push(url)
  });
  await resolver.resolve("blob-one", "/api/assets/blob-one/preview?width=1024");

  // When: repeated LRU eviction exceeds the cache-sized grace window.
  await resolver.resolve("blob-two", "/api/assets/blob-two/preview?width=1024");
  await resolver.resolve("blob-three", "/api/assets/blob-three/preview?width=1024");

  // Then: the oldest retired URL is revoked and total Blob ownership stays bounded.
  assert.deepEqual(revoked, ["blob:asset-1"]);
  assert.equal(resolver.objectUrlCount(), 2);
  resolver.retry("blob-three");
  assert.deepEqual(revoked, ["blob:asset-1", "blob:asset-2"]);
  resolver.release();
  assert.deepEqual(revoked, ["blob:asset-1", "blob:asset-2", "blob:asset-3"]);
});

test("bounds concurrent preview requests as well as settled cache entries", async () => {
  // Given: four assets are requested with a two-request network budget.
  const pending: Array<() => void> = [];
  let active = 0;
  let peakActive = 0;
  const resolver = createCanvasAssetPreviewResolver({
    cacheLimit: 2,
    maxConcurrent: 2,
    fetchImage: () =>
      new Promise((resolve) => {
        active += 1;
        peakActive = Math.max(peakActive, active);
        pending.push(() => {
          active -= 1;
          resolve(new Response(new Blob(["readable"]), { status: 200 }));
        });
      }),
    decodeImage: async () => true
  });

  // When: all four resolutions are started before any network response completes.
  const resolutions = ["one", "two", "three", "four"].map((assetId) =>
    resolver.resolve(assetId, `/api/assets/${assetId}/preview?width=1024`)
  );
  assert.equal(active, 2);
  assert.equal(resolver.entryCount(), 4);
  assert.equal(resolver.queueSize(), 2);
  pending.shift()?.();
  await resolutions[0];
  assert.equal(active, 2);
  pending.shift()?.();
  await resolutions[1];
  pending.shift()?.();
  await resolutions[2];
  pending.shift()?.();
  await Promise.all(resolutions);

  // Then: queued work never exceeds the configured network or cache bounds.
  assert.equal(peakActive, 2);
  assert.equal(resolver.cacheSize(), 2);
});

test("discards queued previews beyond the bounded working set", async () => {
  // Given: the network is saturated and many more assets request previews.
  const resolver = createCanvasAssetPreviewResolver({
    cacheLimit: 2,
    maxConcurrent: 2,
    fetchImage: () => new Promise(() => undefined),
    decodeImage: async () => true
  });

  // When: requests exceed the cache plus concurrency entry budget.
  const resolutions = Array.from({ length: 10 }, (_, index) =>
    resolver.resolve(`queued-${index}`, `/api/assets/queued-${index}/preview?width=1024`)
  );

  // Then: only the active and newest queued working set remains owned.
  assert.equal(resolver.entryCount(), 4);
  assert.equal(resolver.queueSize(), 2);
  assert.equal(await resolutions[2], CANVAS_ASSET_UNAVAILABLE_URL);
  resolver.release();
});

test("keeps every mounted asset revision stable beyond the retained cache limit", async () => {
  const assetIds = Array.from({ length: 193 }, (_, index) => `mounted-${index}`);
  const revisions = assetIds.map((assetId) => assetAvailabilityRevision(assetId));
  const releases = assetIds.map((assetId) => subscribeAssetAvailability(assetId, () => undefined));

  await Promise.resolve();

  assert.equal(assetAvailabilityRevision(assetIds[0]!), revisions[0]);
  releases[0]?.();
  await Promise.resolve();
  assert.notEqual(assetAvailabilityRevision(assetIds[0]!), revisions[0]);
  releases.slice(1).forEach((release) => release());
});

test("notifies only subscribers for the asset that changed", () => {
  const firstAssetId = "notification-first";
  const secondAssetId = "notification-second";
  const firstRevision = assetAvailabilityRevision(firstAssetId);
  assetAvailabilityRevision(secondAssetId);
  let firstNotifications = 0;
  let secondNotifications = 0;
  const releaseFirst = subscribeAssetAvailability(firstAssetId, () => {
    firstNotifications += 1;
  });
  const releaseSecond = subscribeAssetAvailability(secondAssetId, () => {
    secondNotifications += 1;
  });

  reportAssetAvailability(firstAssetId, "/api/assets/notification-first", "unavailable", firstRevision);

  assert.equal(firstNotifications, 1);
  assert.equal(secondNotifications, 0);
  releaseFirst();
  releaseSecond();
});

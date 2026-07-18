import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const {
  createPromptFavoritesRefreshController,
  emitPromptFavoritesInvalidation,
  subscribePromptFavoritesInvalidation
} = await import(new URL("./prompt-favorites-sync.ts", import.meta.url).href);

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const [canvasSource, poolSource] = await Promise.all([
  readFile(path.resolve(currentDir, "../canvas/CanvasApp.tsx"), "utf8"),
  readFile(path.resolve(currentDir, "../pool/PromptPoolPage.tsx"), "utf8")
]);

function installWindowEventTarget() {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const eventTarget = new EventTarget() as EventTarget & Window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    enumerable: true,
    value: eventTarget,
    writable: true
  });
  return () => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "window", originalDescriptor);
      return;
    }

    delete (globalThis as { window?: Window }).window;
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test("prompt favorite invalidation events support subscribe and unsubscribe", () => {
  const restoreWindow = installWindowEventTarget();
  let count = 0;
  const unsubscribe = subscribePromptFavoritesInvalidation(() => {
    count += 1;
  });

  emitPromptFavoritesInvalidation();
  assert.equal(count, 1, "Subscribed listeners should run when favorites are invalidated");

  unsubscribe();
  emitPromptFavoritesInvalidation();
  assert.equal(count, 1, "Unsubscribed listeners should stop receiving invalidation events");

  restoreWindow();
});

test("prompt favorite refresh controller aborts stale requests so only the latest result can apply", async () => {
  const staleRequest = createDeferred();
  const freshRequest = createDeferred();
  const appliedValues: string[] = [];
  const signals: AbortSignal[] = [];
  const refreshController = createPromptFavoritesRefreshController(async (signal: AbortSignal) => {
    const requestIndex = signals.push(signal) - 1;
    if (requestIndex === 0) {
      await staleRequest.promise;
      if (!signal.aborted) {
        appliedValues.push("stale");
      }
      return;
    }

    await freshRequest.promise;
    if (!signal.aborted) {
      appliedValues.push("fresh");
    }
  });

  const staleRun = refreshController.refresh();
  const freshRun = refreshController.refresh();

  assert.equal(signals[0]?.aborted, true, "Starting a new refresh should abort the older in-flight request");

  freshRequest.resolve();
  await freshRun;

  staleRequest.resolve();
  await staleRun;

  assert.deepEqual(appliedValues, ["fresh"], "Stale refreshes must not be allowed to overwrite the latest favorite state");
});

test("prompt pool favorite mutations notify the canvas favorite panel to refresh", () => {
  assert.match(
    canvasSource,
    /import \{ createPromptFavoritesRefreshController, subscribePromptFavoritesInvalidation \} from "\.\.\/prompt-favorites\/prompt-favorites-sync";/u,
    "CanvasApp should wire prompt favorite refreshes through the shared sync helpers"
  );
  assert.match(
    canvasSource,
    /const unsubscribe = subscribePromptFavoritesInvalidation\(\(\) => \{\s*void refreshPromptFavoriteState\(\);\s*\}\);/u,
    "CanvasApp should reload prompt favorites when the prompt pool mutates them"
  );
  assert.match(
    canvasSource,
    /createPromptFavoritesRefreshController\(\(signal\) => promptFavoriteLoadRef\.current\(signal\)\)/u,
    "CanvasApp should reuse one refresh controller so stale favorite requests can be aborted"
  );
  assert.match(
    poolSource,
    /import \{ emitPromptFavoritesInvalidation \} from "\.\.\/prompt-favorites\/prompt-favorites-sync";/u,
    "PromptPoolPage should import the shared prompt favorite invalidation helper"
  );
  assert.match(
    poolSource,
    /await createPromptFavorite\(\{ promptPoolItemId: item\.id \}\);[\s\S]*emitPromptFavoritesInvalidation\(\);/u,
    "Adding a prompt favorite should invalidate the canvas favorite panel state"
  );
  assert.match(
    poolSource,
    /await deletePromptFavorite\(favorite\.id\);[\s\S]*emitPromptFavoritesInvalidation\(\);/u,
    "Removing a prompt favorite should invalidate the canvas favorite panel state"
  );
  assert.match(
    poolSource,
    /const updatedFavorite = await updatePromptFavorite\(favorite\.id, \{ groupId \}\);[\s\S]*upsertFavorite\(updatedFavorite\);[\s\S]*emitPromptFavoritesInvalidation\(\);/u,
    "Moving a prompt favorite between groups should invalidate the canvas favorite panel state"
  );
  assert.match(
    poolSource,
    /const updatedGroup = await updatePromptFavoriteGroup\(group\.id, \{ name \}\);[\s\S]*upsertGroup\(updatedGroup\);[\s\S]*emitPromptFavoritesInvalidation\(\);/u,
    "Renaming a prompt favorite group should invalidate the canvas favorite panel state"
  );
  assert.match(
    poolSource,
    /await deletePromptFavoriteGroup\(group\.id\);[\s\S]*emitPromptFavoritesInvalidation\(\);/u,
    "Deleting a prompt favorite group should invalidate the canvas favorite panel state"
  );
});

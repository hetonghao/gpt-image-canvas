import test from "node:test";
import assert from "node:assert/strict";
import {
  createHostModelCacheKey,
  HostModelResponseError,
  parseHostModelItems
} from "./host-model-cache";

test("separates hosted model caches by user, gateway, and API key", () => {
  const base = {
    apiKeyId: "key-1",
    gatewayBaseUrl: "https://gateway.example.com",
    userId: "user-a"
  };

  assert.notEqual(createHostModelCacheKey(base), createHostModelCacheKey({ ...base, userId: "user-b" }));
  assert.notEqual(
    createHostModelCacheKey(base),
    createHostModelCacheKey({ ...base, gatewayBaseUrl: "https://gateway-two.example.com" })
  );
  assert.notEqual(createHostModelCacheKey(base), createHostModelCacheKey({ ...base, apiKeyId: "key-2" }));
});

test("parses the hosted model response at the HTTP boundary", () => {
  assert.deepEqual(parseHostModelItems({ items: [{ id: "gpt-image-2" }, { id: "gpt-image-4k" }] }), [
    { id: "gpt-image-2" },
    { id: "gpt-image-4k" }
  ]);
  assert.throws(() => parseHostModelItems({ items: [{ id: "" }] }), HostModelResponseError);
  assert.throws(() => parseHostModelItems({ items: "not-an-array" }), HostModelResponseError);
});

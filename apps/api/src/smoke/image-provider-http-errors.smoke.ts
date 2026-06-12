import assert from "node:assert/strict";
import { createOpenAIImageProvider, type ImageProviderInput } from "../infrastructure/providers/image-provider.js";

const originalFetch = globalThis.fetch;

const input: ImageProviderInput = {
  originalPrompt: "test",
  presetId: "default",
  prompt: "test",
  size: {
    width: 1024,
    height: 1024
  },
  sizeApiValue: "1024x1024",
  quality: "high",
  outputFormat: "png",
  count: 1
};

try {
  globalThis.fetch = async () =>
    new Response("", {
      status: 524,
      headers: {
        "content-type": "text/plain"
      }
    });

  const provider = createOpenAIImageProvider({
    apiKey: "test-key",
    baseURL: "https://long-api.ai-cove.com",
    model: "gpt-image-2",
    timeoutMs: 1000
  });

  await assert.rejects(
    () => provider.generate(input),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.match(
        (error as Error).message,
        /AI Cove 网关请求超时|生成耗时过长/u
      );
      return true;
    }
  );

  const genericProvider = createOpenAIImageProvider({
    apiKey: "test-key",
    baseURL: "https://api.ai-cove.com",
    model: "gpt-image-2",
    timeoutMs: 1000
  });

  await assert.rejects(
    () => genericProvider.generate(input),
    (error: unknown) => {
      assert.equal(error instanceof Error, true);
      assert.equal((error as Error).message, "OpenAI 图像服务请求失败（HTTP 524）。");
      return true;
    }
  );

  process.stdout.write("image-provider-http-errors.smoke.ts passed\n");
} finally {
  globalThis.fetch = originalFetch;
}

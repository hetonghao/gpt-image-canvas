const fetchCalls: string[] = [];
const fetchBodies: string[] = [];
let retryCountHeader = "1";
let fetchStatus = 400;
let responseBody: unknown = {
  error: {
    message: "request rejected; Authorization: Bearer secret-token; internal_url=http://127.0.0.1/private"
  }
};

const originalFetch = globalThis.fetch;

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  fetchCalls.push(url);
  fetchBodies.push(typeof init?.body === "string" ? init.body : "");
  if (url === "https://assets.example.test/broken.png") {
    return new Response(null, { status: 503 });
  }
  return new Response(
    JSON.stringify(responseBody),
    {
      status: fetchStatus,
      headers: {
        "content-type": "application/json",
        "x-ai-cove-retry-count": retryCountHeader
      }
    }
  );
};

const { ProviderError, createOpenAIImageProvider, resolveImageModelRoute } = await import("../infrastructure/providers/image-provider.js");
const provider = createOpenAIImageProvider({
  apiKey: "sk-test",
  baseURL: "https://ai-cove.com/v1",
  model: "gpt-image-2",
  model2K: "gpt-image-2-hd",
  model4K: "gpt-image-2-ultra",
  timeoutMs: 1000
});

try {
  expect(
    resolveImageModelRoute({ width: 1024, height: 1024 }, { model: "default", model2K: "two", model4K: "four" }).model === "default",
    "1K uses the default model"
  );
  expect(
    resolveImageModelRoute({ width: 2048, height: 1024 }, { model: "default", model2K: "two", model4K: "four" }).model === "two",
    "2K uses the configured 2K model"
  );
  expect(
    resolveImageModelRoute({ width: 2048, height: 1024 }, { model: "default" }).fallbackToDefault,
    "missing 2K model falls back to default"
  );
  expect(
    resolveImageModelRoute({ width: 3840, height: 2160 }, { model: "default", model2K: "two" }).model === "default",
    "missing 4K model falls directly back to default"
  );

  await provider.generate({
    originalPrompt: "draw it",
    presetId: "manual",
    prompt: "draw it",
    size: { width: 2160, height: 3840 },
    sizeApiValue: "2160x3840",
    quality: "high",
    outputFormat: "png",
    count: 1
  });

  throw new Error("expected provider.generate to fail");
} catch (error) {
  expect(error instanceof ProviderError, "provider.generate surfaces ProviderError");
  expect(
    error.message === "OpenAI 图像服务拒绝了当前请求（HTTP 400）。请检查提示词、尺寸、格式或模型参数后重试。",
    `message = ${String((error as Error).message)}`
  );
  expect(!error.message.includes("secret-token"), "provider error does not expose an authorization token");
  expect(!error.message.includes("127.0.0.1"), "provider error does not expose internal request details");
  expect((error as { status?: number }).status === 400, `status = ${String((error as { status?: number }).status)}`);
  expect(error.retryCount === 1, `retry count = ${String(error.retryCount)}`);
  expect(fetchCalls.length === 1, `fetch call count = ${fetchCalls.length}`);
  expect(fetchCalls[0] === "https://ai-cove.com/v1/images/generations", `fetch url = ${fetchCalls[0]}`);

  const requestBody = JSON.parse(fetchBodies[0] ?? "{}") as Record<string, unknown>;
  expect(requestBody.model === "gpt-image-2-ultra", `model = ${String(requestBody.model)}`);
  expect(requestBody.size === "2160x3840", `size = ${String(requestBody.size)}`);
  expect(requestBody.response_format === "b64_json", `response_format = ${String(requestBody.response_format)}`);
}

fetchStatus = 200;
retryCountHeader = "2";
responseBody = { data: [{ b64_json: "aGVsbG8=" }] };
const success = await provider.generate({
  originalPrompt: "draw it again",
  presetId: "manual",
  prompt: "draw it again",
  size: { width: 1024, height: 1024 },
  sizeApiValue: "1024x1024",
  quality: "high",
  outputFormat: "png",
  count: 1
});
expect(success.retryCount === 2, `successful retry count = ${String(success.retryCount)}`);

retryCountHeader = "3";
responseBody = { unexpected: true };
try {
  await provider.generate({
    originalPrompt: "invalid success body",
    presetId: "manual",
    prompt: "invalid success body",
    size: { width: 1024, height: 1024 },
    sizeApiValue: "1024x1024",
    quality: "high",
    outputFormat: "png",
    count: 1
  });
  throw new Error("expected invalid success body to fail");
} catch (error) {
  expect(error instanceof ProviderError, "invalid HTTP 200 response surfaces ProviderError");
  expect(error.retryCount === 3, `invalid response retry count = ${String(error.retryCount)}`);
}

retryCountHeader = "4";
responseBody = { data: [{ url: "https://assets.example.test/broken.png" }] };
try {
  await provider.generate({
    originalPrompt: "broken image URL",
    presetId: "manual",
    prompt: "broken image URL",
    size: { width: 1024, height: 1024 },
    sizeApiValue: "1024x1024",
    quality: "high",
    outputFormat: "png",
    count: 1
  });
  throw new Error("expected image URL download to fail");
} catch (error) {
  expect(error instanceof ProviderError, "image URL download failure surfaces ProviderError");
  expect(error.retryCount === 4, `image URL retry count = ${String(error.retryCount)}`);
}

retryCountHeader = "5";
responseBody = { data: [] };
try {
  await provider.generate({
    originalPrompt: "empty image response",
    presetId: "manual",
    prompt: "empty image response",
    size: { width: 1024, height: 1024 },
    sizeApiValue: "1024x1024",
    quality: "high",
    outputFormat: "png",
    count: 1
  });
  throw new Error("expected empty image response to fail");
} catch (error) {
  expect(error instanceof ProviderError, "empty image response surfaces ProviderError");
  expect(error.retryCount === 5, `empty response retry count = ${String(error.retryCount)}`);
}

fetchStatus = 400;
retryCountHeader = "1";
responseBody = {
  error: {
    message: "model private-image-model is unavailable; Authorization: Bearer secret-token"
  }
};
try {
  await provider.generate({
    originalPrompt: "classified model failure",
    presetId: "manual",
    prompt: "classified model failure",
    size: { width: 1024, height: 1024 },
    sizeApiValue: "1024x1024",
    quality: "high",
    outputFormat: "png",
    count: 1
  });
  throw new Error("expected classified model failure");
} catch (error) {
  expect(error instanceof ProviderError, "structured model failure surfaces ProviderError");
  expect(
    error.message === "OpenAI 图像服务无法使用当前模型（HTTP 400）。请检查所选模型是否支持图像生成。",
    `classified message = ${error.message}`
  );
  expect(!error.message.includes("private-image-model"), "classified provider error does not expose a private model id");
  expect(!error.message.includes("secret-token"), "classified provider error does not expose an authorization token");
}

fetchStatus = 500;
retryCountHeader = "";
responseBody = { error: { message: "controlled SDK failure" } };
const sdkProvider = createOpenAIImageProvider({
  apiKey: "sk-test",
  baseURL: "https://example.test/v1",
  model: "gpt-image-2",
  timeoutMs: 1000
});
const sdkFetchCountBefore = fetchCalls.length;
try {
  await sdkProvider.generate({
    originalPrompt: "no hidden retries",
    presetId: "manual",
    prompt: "no hidden retries",
    size: { width: 1024, height: 1024 },
    sizeApiValue: "1024x1024",
    quality: "high",
    outputFormat: "png",
    count: 1
  });
  throw new Error("expected SDK provider.generate to fail");
} catch (error) {
  expect(error instanceof ProviderError, "SDK provider failure surfaces ProviderError");
  expect(fetchCalls.length === sdkFetchCountBefore + 1, `SDK fetch call count = ${fetchCalls.length - sdkFetchCountBefore}`);
}

console.log("image-provider-ai-cove-error.smoke.ts passed");

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

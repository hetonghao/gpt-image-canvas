const fetchCalls: string[] = [];

globalThis.fetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  fetchCalls.push(url);
  return new Response(JSON.stringify({ error: { message: "refusal from gateway" } }), {
    status: 400,
    headers: {
      "content-type": "application/json"
    }
  });
};

const { ProviderError, createOpenAIImageProvider } = await import("../infrastructure/providers/image-provider.js");

try {
  const provider = createOpenAIImageProvider({
    apiKey: "sk-test",
    baseURL: "https://ai-cove.com/v1",
    model: "gpt-image-2",
    timeoutMs: 1000
  });

  await provider.generate({
    originalPrompt: "draw it",
    presetId: "manual",
    prompt: "draw it",
    size: { width: 1024, height: 1536 },
    sizeApiValue: "1024x1536",
    quality: "high",
    outputFormat: "png",
    count: 1
  });

  throw new Error("expected provider.generate to fail");
} catch (error) {
  expect(error instanceof ProviderError, "provider.generate surfaces ProviderError");
  expect(error.message === "refusal from gateway", `message = ${String((error as Error).message)}`);
  expect((error as { status?: number }).status === 400, `status = ${String((error as { status?: number }).status)}`);
  expect(fetchCalls.length === 1, `fetch call count = ${fetchCalls.length}`);
  expect(fetchCalls[0] === "https://ai-cove.com/v1/images/generations", `fetch url = ${fetchCalls[0]}`);
}

console.log("image-provider-ai-cove-error.smoke.ts passed");

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-provider-config-"));

process.env.DATA_DIR = dataDir;
process.env.HOST_ADAPTER = "ai-cove-new-api";
process.env.AI_COVE_API_BASE_URL = "https://new-api.example";
process.env.AI_COVE_PUBLIC_BASE_URL = "https://public.example";
process.env.OPENAI_API_KEY = "environment-key";

const requests: string[] = [];

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const parsed = new URL(url);
  const headers = new Headers(init?.headers);
  requests.push(`${init?.method ?? "GET"} ${parsed.pathname}`);

  if (parsed.pathname === "/api/token/") {
    expect(headers.get("new-api-user") === "42", "token list includes New-Api-User");
    return json({
      success: true,
      data: {
        items: [
          {
            id: 7,
            name: "Design key",
            status: 1,
            group: "default",
            remain_quota: 123,
            used_quota: 5,
            key: "sk-desi********1111"
          }
        ]
      }
    });
  }

  if (parsed.pathname === "/api/token/7/key") {
    expect(init?.method === "POST", "token reveal uses POST");
    expect(headers.get("new-api-user") === "42", "token reveal includes New-Api-User");
    return json({
      success: true,
      data: {
        key: "sk-real-token"
      }
    });
  }

  return json({ success: false, message: `unexpected path ${parsed.pathname}` }, 404);
};

try {
  const { DEFAULT_PROVIDER_SOURCE_ORDER, getProviderConfig, getProviderSourceOrder, saveProviderConfig } = await import("../domain/providers/provider-config.js");
  const { createConfiguredImageProvider, selectConfiguredImageProviderSource } = await import("../domain/providers/image-provider-selection.js");
  const { parseProviderConfigPayload } = await import("../server/http/validation.js");

  const hostContext = {
    token: "dashboard-token",
    userId: "42",
    user: {
      id: "42",
      displayName: "Ada",
      email: "ada@example.com"
    }
  };

  const unconfigured = await getProviderConfig(hostContext);
  assert.deepEqual(getProviderSourceOrder(hostContext), ["local-openai"], "AI Cove runtime only selects the user-configured image adapter");
  assert.deepEqual(
    unconfigured.sourceOrder,
    DEFAULT_PROVIDER_SOURCE_ORDER,
    "AI Cove config persistence keeps the complete standalone-compatible source order"
  );
  expect(unconfigured.activeSource === undefined, "environment credentials never become the AI Cove active image source");
  expect(
    (await selectConfiguredImageProviderSource(undefined, hostContext)) === undefined,
    "AI Cove runtime does not fall back to environment or Codex providers"
  );
  await assert.rejects(
    createConfiguredImageProvider(undefined, hostContext),
    /平台 API Key.*默认图片模型/u,
    "unconfigured AI Cove generation directs the user back to the visible provider settings"
  );

  const legacyCompatible = await saveProviderConfig(
    {
      sourceOrder: DEFAULT_PROVIDER_SOURCE_ORDER,
      localOpenAI: {
        apiKeyId: "7"
      }
    },
    hostContext
  );
  expect(legacyCompatible.localOpenAI.model === "gpt-image-2", "legacy partial provider saves restore the required default model");

  const invalidPayload = parseProviderConfigPayload({
    sourceOrder: DEFAULT_PROVIDER_SOURCE_ORDER,
    localOpenAI: {
      model: "   "
    }
  });
  expect(!invalidPayload.ok, "the HTTP boundary rejects an empty default image model");

  await assert.rejects(
    saveProviderConfig(
      {
        sourceOrder: DEFAULT_PROVIDER_SOURCE_ORDER,
        localOpenAI: {
          model: "   "
        }
      },
      hostContext
    ),
    /default image model|required/u,
    "the domain boundary rejects an empty default image model"
  );

  const saved = await saveProviderConfig(
    {
      sourceOrder: DEFAULT_PROVIDER_SOURCE_ORDER,
      localOpenAI: {
        apiKeyId: "7",
        baseUrl: "https://public.example/v1",
        model: "gpt-image-2",
        model2K: "  gpt-image-2-hd  ",
        model4K: "  gpt-image-2-ultra  ",
        timeoutMs: 1200000
      }
    },
    hostContext
  );

  expect(saved.localOpenAI.apiKey.hasSecret, "saved provider config treats selected summary-only host key as configured");
  expect(saved.localOpenAI.model2K === "gpt-image-2-hd", "saved provider config keeps the 2K model");
  expect(saved.localOpenAI.model4K === "gpt-image-2-ultra", "saved provider config keeps the 4K model");
  assert.deepEqual(saved.sourceOrder, DEFAULT_PROVIDER_SOURCE_ORDER, "saved config preserves the standalone-compatible source order");
  expect(saved.activeSource?.id === "local-openai", "saved provider config selects local OpenAI source");
  expect(saved.activeSource?.available, "saved local OpenAI source is available");

  const reloaded = await getProviderConfig(hostContext);
  expect(reloaded.localOpenAI.apiKey.hasSecret, "reloaded provider config keeps selected summary-only host key configured");
  expect(reloaded.localOpenAI.model2K === "gpt-image-2-hd", "reloaded provider config keeps the 2K model");
  expect(reloaded.localOpenAI.model4K === "gpt-image-2-ultra", "reloaded provider config keeps the 4K model");
  expect(reloaded.activeSource?.id === "local-openai", "reloaded provider config selects local OpenAI source");
  expect(reloaded.activeSource?.available, "reloaded local OpenAI source is available");

  const preserved = await saveProviderConfig(
    {
      sourceOrder: DEFAULT_PROVIDER_SOURCE_ORDER,
      localOpenAI: {
        apiKeyId: "7"
      }
    },
    hostContext
  );
  expect(preserved.localOpenAI.model2K === "gpt-image-2-hd", "omitting the 2K model preserves its saved value");
  expect(preserved.localOpenAI.model4K === "gpt-image-2-ultra", "omitting the 4K model preserves its saved value");

  const cleared = await saveProviderConfig(
    {
      sourceOrder: DEFAULT_PROVIDER_SOURCE_ORDER,
      localOpenAI: {
        apiKeyId: "7",
        model2K: "",
        model4K: "   "
      }
    },
    hostContext
  );
  expect(cleared.localOpenAI.model2K === undefined, "an explicit empty 2K model clears the saved value");
  expect(cleared.localOpenAI.model4K === undefined, "an explicit empty 4K model clears the saved value");
  expect(cleared.localOpenAI.resolvedModel2K === "gpt-image-2", "the server returns the effective 2K fallback model");
  expect(cleared.localOpenAI.resolvedModel4K === "gpt-image-2", "the server returns the effective 4K fallback model");
  expect(
    cleared.sources.find((source) => source.id === "local-openai")?.details.resolvedModel4K === "gpt-image-2",
    "the active source exposes the server-resolved 4K model"
  );
  expect(requests.includes("POST /api/token/7/key"), "saving still reveals the selected key for authorization");

  console.log("provider-config-new-api-summary.smoke.ts passed");
} finally {
  rmSync(dataDir, { force: true, recursive: true });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-provider-config-"));

process.env.DATA_DIR = dataDir;
process.env.HOST_ADAPTER = "ai-cove-new-api";
process.env.AI_COVE_API_BASE_URL = "https://new-api.example";
process.env.AI_COVE_PUBLIC_BASE_URL = "https://public.example";

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
  const { DEFAULT_PROVIDER_SOURCE_ORDER, getProviderConfig, saveProviderConfig } = await import("../domain/providers/provider-config.js");

  const hostContext = {
    token: "dashboard-token",
    userId: "42",
    user: {
      id: "42",
      displayName: "Ada",
      email: "ada@example.com"
    }
  };

  const saved = await saveProviderConfig(
    {
      sourceOrder: DEFAULT_PROVIDER_SOURCE_ORDER,
      localOpenAI: {
        apiKeyId: "7",
        baseUrl: "https://public.example/v1",
        model: "gpt-image-2",
        timeoutMs: 1200000
      }
    },
    hostContext
  );

  expect(saved.localOpenAI.apiKey.hasSecret, "saved provider config treats selected summary-only host key as configured");
  expect(saved.activeSource?.id === "local-openai", "saved provider config selects local OpenAI source");
  expect(saved.activeSource?.available, "saved local OpenAI source is available");

  const reloaded = await getProviderConfig(hostContext);
  expect(reloaded.localOpenAI.apiKey.hasSecret, "reloaded provider config keeps selected summary-only host key configured");
  expect(reloaded.activeSource?.id === "local-openai", "reloaded provider config selects local OpenAI source");
  expect(reloaded.activeSource?.available, "reloaded local OpenAI source is available");
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

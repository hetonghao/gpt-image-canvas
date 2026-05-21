process.env.HOST_ADAPTER = "ai-cove-new-api";
process.env.AI_COVE_API_BASE_URL = "https://new-api.example";
process.env.AI_COVE_PUBLIC_BASE_URL = "https://public.example";

type CapturedRequest = {
  url: string;
  method: string;
  authorization: string;
  cookie: string;
  newApiUser: string;
};

const requests: CapturedRequest[] = [];

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const headers = new Headers(init?.headers);
  const parsed = new URL(url);
  requests.push({
    url,
    method: init?.method ?? "GET",
    authorization: headers.get("authorization") ?? "",
    cookie: headers.get("cookie") ?? "",
    newApiUser: headers.get("new-api-user") ?? ""
  });

  if (parsed.pathname === "/api/user/self") {
    expect(headers.get("authorization") === null, "cookie session request does not need access token");
    expect(headers.get("cookie") === "session=abc", "user request forwards session cookie");
    expect(headers.get("new-api-user") === "42", "user request includes New-Api-User");
    return json({
      success: true,
      data: {
        id: 42,
        username: "ada",
        email: "ada@example.com"
      }
    });
  }

  if (parsed.pathname === "/api/token/") {
    expect(headers.get("authorization") === null, "cookie token list does not need access token");
    expect(headers.get("cookie") === "session=abc", "token list forwards session cookie");
    expect(headers.get("new-api-user") === "42", "token list includes New-Api-User");
    expect(parsed.searchParams.get("p") === "1", "token list uses p=1");
    expect(parsed.searchParams.get("size") === "100", "token list uses size=100");
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
    expect(headers.get("authorization") === null, "cookie token reveal does not need access token");
    expect(headers.get("cookie") === "session=abc", "token reveal forwards session cookie");
    expect(headers.get("new-api-user") === "42", "token reveal includes New-Api-User");
    return json({
      success: true,
      data: {
        key: "sk-real-token"
      }
    });
  }

  if (parsed.pathname === "/v1/models") {
    expect(headers.get("authorization") === "Bearer sk-real-token", "model list uses revealed token key");
    expect(headers.get("new-api-user") === null, "model list does not send dashboard user id");
    return json({
      object: "list",
      data: [{ id: "gpt-image-1" }]
    });
  }

  return json({ success: false, message: `unexpected path ${parsed.pathname}` }, 404);
};

const { hostGatewayBaseUrl, isHostedAiCoveMode, listHostApiKeys, listHostModels, resolveHostContext } = await import("../domain/host/host-adapter.js");

expect(isHostedAiCoveMode(), "new-api adapter is treated as a hosted AI Cove mode");

const resolved = await resolveHostContext({
  cookie: "session=abc",
  userId: "42"
});
expect(resolved.ok, "new-api host context resolves");
if (!resolved.ok) {
  throw new Error("host context did not resolve");
}
expect(resolved.context.user.id === "42", "resolved user id is parsed");
expect(resolved.context.user.displayName === "ada", "resolved username is used as display name");
expect(resolved.context.user.email === "ada@example.com", "resolved email is parsed");

const keys = await listHostApiKeys(resolved.context);
expect(keys.length === 1, "one token is listed");
expect(keys[0]?.summary.id === "7", "token id is mapped");
expect(keys[0]?.summary.name === "Design key", "token name is mapped");
expect(keys[0]?.summary.status === "1", "numeric token status is stringified");
expect(keys[0]?.summary.group === "default", "token group is mapped");
expect(keys[0]?.summary.quota?.remaining === 123, "remaining quota is mapped");
expect(keys[0]?.summary.quota?.used === 5, "used quota is mapped");
expect(keys[0]?.key === undefined, "token list does not reveal full token key");
expect(!requests.some((request) => request.url === "https://new-api.example/api/token/7/key"), "token list avoids reveal endpoint");

const models = await listHostModels(resolved.context, "7");
expect(models.length === 1 && models[0]?.id === "gpt-image-1", "models are listed with revealed key");
expect(hostGatewayBaseUrl() === "https://public.example/v1", "gateway public base adds /v1");
expect(requests.some((request) => request.url === "https://new-api.example/api/user/self"), "session request captured");

console.log("host adapter new-api smoke checks passed");

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

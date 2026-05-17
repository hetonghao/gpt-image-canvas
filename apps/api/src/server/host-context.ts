import type { Context, MiddlewareHandler } from "hono";
import type { HostModelsResponse } from "../domain/contracts.js";
import { hostSessionResponse, listHostApiKeys, listHostModels, resolveHostContext, type HostContext } from "../domain/host/host-adapter.js";
import { errorResponse } from "./http/errors.js";

export type HostVariables = {
  hostContext?: HostContext;
};

export type HostHonoEnv = { Variables: HostVariables };

export type HostHonoContext = Context<HostHonoEnv>;

export const hostContextMiddleware: MiddlewareHandler<{ Variables: HostVariables }> = async (c, next) => {
  if (c.req.path === "/api/health") {
    await next();
    return;
  }

  const resolved = await resolveHostContext({
    authorization: c.req.header("authorization"),
    token: c.req.query("token"),
    signal: c.req.raw.signal
  });

  if (!resolved.ok) {
    return c.json(errorResponse(resolved.code, resolved.message), resolved.status as 401);
  }

  c.set("hostContext", resolved.context);
  await next();
};

export function requireHostContext(c: Context): HostContext {
  const context = (c as Context & { get: (key: string) => unknown }).get("hostContext");
  if (!context) {
    throw new Error("Host context is missing.");
  }

  return context;
}

export async function hostApiKeysResponse(context: HostContext, signal?: AbortSignal): Promise<{ items: ReturnType<typeof toSummaries> }> {
  return {
    items: toSummaries(await listHostApiKeys(context, signal))
  };
}

export async function hostModelsResponse(
  context: HostContext,
  apiKeyId: string,
  signal?: AbortSignal
): Promise<HostModelsResponse> {
  return {
    items: await listHostModels(context, apiKeyId, signal)
  };
}

function toSummaries(records: Awaited<ReturnType<typeof listHostApiKeys>>) {
  return records.map((record) => record.summary);
}

export { hostSessionResponse };

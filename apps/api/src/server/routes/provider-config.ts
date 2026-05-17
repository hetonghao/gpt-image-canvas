import type { Hono } from "hono";
import { getProviderConfigWithSeed, saveProviderConfig } from "../../domain/providers/provider-config.js";
import { requireHostContext } from "../host-context.js";
import { errorResponse, errorToMessage } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseProviderConfigPayload } from "../http/validation.js";

export function registerProviderConfigRoutes(app: Hono): void {
  app.get("/api/provider-config", async (c) =>
    c.json(await getProviderConfigWithSeed(c.req.query("base_url"), requireHostContext(c), c.req.raw.signal))
  );

  app.put("/api/provider-config", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseProviderConfigPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await saveProviderConfig(parsed.value, requireHostContext(c), c.req.raw.signal));
    } catch (error) {
      return c.json(errorResponse("provider_config_error", errorToMessage(error)), 400);
    }
  });
}

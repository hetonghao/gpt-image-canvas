import type { Hono } from "hono";
import { hostApiKeysResponse, hostModelsResponse, hostSessionResponse, requireHostContext } from "../host-context.js";
import { errorResponse } from "../http/errors.js";

export function registerHostRoutes(app: Hono): void {
  app.get("/api/host/session", (c) => c.json(hostSessionResponse(requireHostContext(c))));

  app.get("/api/host/api-keys", async (c) => c.json(await hostApiKeysResponse(requireHostContext(c), c.req.raw.signal)));

  app.get("/api/host/models", async (c) => {
    const apiKeyId = c.req.query("apiKeyId")?.trim();
    if (!apiKeyId) {
      return c.json(errorResponse("invalid_request", "apiKeyId is required."), 400);
    }

    try {
      return c.json(await hostModelsResponse(requireHostContext(c), apiKeyId, c.req.raw.signal));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Host API returned 403.") || message.includes("Host API returned 404.")) {
        return c.json({ items: [] });
      }

      throw error;
    }
  });
}

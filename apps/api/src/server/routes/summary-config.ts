import type { Hono } from "hono";
import { getSummaryLlmConfig, saveSummaryLlmConfig } from "../../domain/summary/config.js";
import { requireHostContext } from "../host-context.js";
import { errorResponse, errorToMessage } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseSummaryLlmConfigPayload } from "../http/validation.js";

export function registerSummaryConfigRoutes(app: Hono): void {
  app.get("/api/summary-config", (c) => c.json(getSummaryLlmConfig(requireHostContext(c))));

  app.put("/api/summary-config", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseSummaryLlmConfigPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json(await saveSummaryLlmConfig(parsed.value, requireHostContext(c), c.req.raw.signal));
    } catch (error) {
      return c.json(errorResponse("summary_config_error", errorToMessage(error)), 400);
    }
  });
}

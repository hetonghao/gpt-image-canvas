import type { Hono } from "hono";
import {
  cancelGenerationTask,
  initializeGenerationTaskManager,
  readGenerationTaskRecord,
  startReferenceImageGenerationTask,
  startTextToImageGenerationTask
} from "../../domain/generation/generation-tasks.js";
import { regionSummaryFailureCode, resolveRegionSummaryModelConfig, summarizeImageRegion } from "../../domain/summary/region-summary.js";
import { ProviderError } from "../../infrastructure/providers/image-provider.js";
import { errorResponse, errorToMessage, providerErrorJson } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { parseEditPayload, parseGeneratePayload, parseRegionSummaryPayload } from "../http/validation.js";
import { requireHostContext } from "../host-context.js";

export function registerImageRoutes(app: Hono): void {
  initializeGenerationTaskManager();

  app.post("/api/images/generate", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseGeneratePayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json({ record: startTextToImageGenerationTask(parsed.value, requireHostContext(c)) });
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.post("/api/images/edit", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const hostContext = requireHostContext(c);
    const parsed = parseEditPayload(payload.value, hostContext);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    try {
      return c.json({ record: await startReferenceImageGenerationTask(parsed.value, hostContext) });
    } catch (error) {
      if (error instanceof ProviderError) {
        return providerErrorJson(c, error);
      }

      throw error;
    }
  });

  app.post("/api/images/region-summary", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    const parsed = parseRegionSummaryPayload(payload.value);
    if (!parsed.ok) {
      return c.json(parsed.error, 400);
    }

    const modelConfig = await resolveRegionSummaryModelConfig(requireHostContext(c), c.req.raw.signal);
    if (!modelConfig.ok) {
      return c.json(errorResponse(modelConfig.code, modelConfig.message), 400);
    }

    try {
      return c.json(
        await summarizeImageRegion({
          request: parsed.value,
          config: modelConfig.config,
          signal: c.req.raw.signal
        })
      );
    } catch (error) {
      console.warn("[region-summary] upstream request failed:", errorToMessage(error));
      return c.json(errorResponse(regionSummaryFailureCode(error), "Region summary failed."), 502);
    }
  });

  app.get("/api/generations/:id", (c) => {
    const generationId = c.req.param("id").trim();
    const record = generationId ? readGenerationTaskRecord(generationId, requireHostContext(c)) : undefined;
    if (!record) {
      return c.json(errorResponse("not_found", "Generation record not found."), 404);
    }

    return c.json({ record });
  });

  app.post("/api/generations/:id/cancel", (c) => {
    const generationId = c.req.param("id").trim();
    const record = generationId ? cancelGenerationTask(generationId, requireHostContext(c)) : undefined;
    if (!record) {
      return c.json(errorResponse("not_found", "Generation record not found."), 404);
    }

    return c.json({ record });
  });
}

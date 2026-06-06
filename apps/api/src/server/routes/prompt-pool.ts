import type { Hono } from "hono";
import { getPromptPool } from "../../domain/prompt-pool/prompt-pool.js";

export function registerPromptPoolRoutes(app: Hono): void {
  app.get("/api/pool", async (c) => c.json(await getPromptPool()));
}

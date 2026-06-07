import type { Hono } from "hono";
import { getPromptPool, getPromptPoolItem } from "../../domain/prompt-pool/prompt-pool.js";

export function registerPromptPoolRoutes(app: Hono): void {
  app.get("/api/pool", async (c) =>
    c.json(
      await getPromptPool({
        limit: c.req.query("limit"),
        mediaType: c.req.query("mediaType"),
        model: c.req.query("model"),
        offset: c.req.query("offset"),
        q: c.req.query("q"),
        sort: c.req.query("sort")
      })
    )
  );
  app.get("/api/pool/:id", async (c) => {
    const detail = await getPromptPoolItem(c.req.param("id"));
    return c.json(detail, detail.available ? 200 : 404);
  });
}

import { relative } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { runtimePaths } from "../infrastructure/runtime.js";
import { errorResponse } from "./http/errors.js";
import { registerAgentConfigRoutes } from "./routes/agent-config.js";
import { registerAgentConversationRoutes } from "./routes/agent-conversations.js";
import { registerAgentSkillRoutes } from "./routes/agent-skills.js";
import { registerAgentWebSocketRoutes } from "./routes/agent-ws.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCoreRoutes } from "./routes/core.js";
import { registerGalleryRoutes } from "./routes/gallery.js";
import { registerHostRoutes } from "./routes/host.js";
import { registerImageRoutes } from "./routes/images.js";
import { registerProjectRoutes } from "./routes/project.js";
import { registerProviderConfigRoutes } from "./routes/provider-config.js";
import { registerStorageRoutes } from "./routes/storage.js";
import { hostContextMiddleware } from "./host-context.js";

export const agentWebSocketServer = new WebSocketServer({ noServer: true });
export const app = createApp();

export function createApp(): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    console.error(error);
    return c.json(errorResponse("internal_error", "Internal server error."), 500);
  });

  app.use("/api/*", hostContextMiddleware);

  registerCoreRoutes(app);
  registerHostRoutes(app);
  registerAuthRoutes(app);
  registerProviderConfigRoutes(app);
  registerAgentConfigRoutes(app);
  registerAgentConversationRoutes(app);
  registerAgentSkillRoutes(app);
  registerProjectRoutes(app);
  registerGalleryRoutes(app);
  registerStorageRoutes(app);
  registerAssetRoutes(app);
  registerImageRoutes(app);
  registerAgentWebSocketRoutes(app);

  const webDistRoot = relative(process.cwd(), runtimePaths.webDistDir) || ".";

  app.get("/api/*", (c) => c.json(errorResponse("not_found", "Not found."), 404));

  app.use("/assets/*", async (c, next) => {
    await next();

    if (!c.res.ok && c.res.status !== 206) {
      return;
    }

    const contentType = c.res.headers.get("Content-Type") ?? "";
    if (contentType.startsWith("text/html")) {
      return;
    }

    const headers = new Headers(c.res.headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers
    });
  });

  app.get("/assets/*", serveStatic({ root: webDistRoot }));

  app.get("*", serveStatic({ root: webDistRoot }));
  app.get(
    "*",
    serveStatic({
      root: webDistRoot,
      path: "index.html",
      onNotFound: () => {
        console.error(`Built web bundle not found at ${runtimePaths.webDistDir}. Run pnpm build before pnpm start.`);
      }
    })
  );

  return app;
}

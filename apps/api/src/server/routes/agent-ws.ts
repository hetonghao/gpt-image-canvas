import { upgradeWebSocket } from "@hono/node-server";
import type { Hono } from "hono";
import { createAgentWebSocketEvents } from "../../domain/agent/websocket-session.js";
import { requireHostContext } from "../host-context.js";

export function registerAgentWebSocketRoutes(app: Hono): void {
  app.get(
    "/api/agent/ws",
    upgradeWebSocket((c) => {
      return createAgentWebSocketEvents(c.req.query("connectionId"), c.req.query("runId"), c.req.query("conversationId"), requireHostContext(c));
    }, {
      onError(error) {
        console.error("Agent WebSocket error.", error);
      }
    })
  );
}

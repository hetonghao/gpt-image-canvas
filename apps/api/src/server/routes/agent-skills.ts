import type { Hono } from "hono";
import {
  AgentSkillError,
  createAgentSkill,
  getAgentSkill,
  importAgentSkillFromUpload,
  listAgentSkills,
  saveAgentSkill
} from "../../domain/agent/skill-store.js";
import type { SaveAgentSkillRequest } from "../../domain/contracts.js";
import { errorResponse, errorToMessage } from "../http/errors.js";
import { readJson } from "../http/json.js";
import { requireHostContext } from "../host-context.js";

export function registerAgentSkillRoutes(app: Hono): void {
  app.get("/api/agent-skills", (c) => c.json(listAgentSkills(requireHostContext(c))));

  app.get("/api/agent-skills/:id", (c) => {
    const skill = getAgentSkill(c.req.param("id"), requireHostContext(c));
    if (!skill) {
      return c.json(errorResponse("agent_skill_not_found", "Agent skill was not found."), 404);
    }

    return c.json({ skill });
  });

  app.post("/api/agent-skills", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    try {
      return c.json(createAgentSkill(payload.value as SaveAgentSkillRequest, requireHostContext(c)), 201);
    } catch (error) {
      return agentSkillErrorJson(error);
    }
  });

  app.put("/api/agent-skills/:id", async (c) => {
    const payload = await readJson(c.req.raw);
    if (!payload.ok) {
      return c.json(payload.error, 400);
    }

    try {
      return c.json(saveAgentSkill(c.req.param("id"), payload.value as SaveAgentSkillRequest, requireHostContext(c)));
    } catch (error) {
      return agentSkillErrorJson(error);
    }
  });

  app.post("/api/agent-skills/import", async (c) => {
    const contentType = c.req.header("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return c.json(errorResponse("unsupported_media_type", "Agent skill import requires multipart/form-data."), 415);
    }

    let formData: FormData;
    try {
      formData = await c.req.raw.formData();
    } catch (error) {
      return c.json(errorResponse("invalid_agent_skill", errorToMessage(error)), 400);
    }

    const file = formData.get("file") ?? formData.get("skill") ?? formData.get("bundle");
    if (!(file instanceof File)) {
      return c.json(errorResponse("agent_skill_invalid_file", "Upload a SKILL.md file or zip bundle."), 400);
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return c.json(
        importAgentSkillFromUpload({
          fileName: file.name,
          mediaType: file.type,
          bytes
        }, requireHostContext(c)),
        201
      );
    } catch (error) {
      return agentSkillErrorJson(error);
    }
  });
}

function agentSkillErrorJson(error: unknown): Response {
  if (error instanceof AgentSkillError) {
    return new Response(JSON.stringify(errorResponse(error.code, error.message)), {
      status: agentSkillHttpStatus(error.code),
      headers: {
        "Content-Type": "application/json"
      }
    });
  }

  return new Response(JSON.stringify(errorResponse("agent_skill_error", errorToMessage(error))), {
    status: 400,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

function agentSkillHttpStatus(code: string): number {
  if (code === "agent_skill_not_found") {
    return 404;
  }

  if (code === "unsupported_media_type") {
    return 415;
  }

  return 400;
}

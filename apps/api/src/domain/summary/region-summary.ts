import { ChatOpenAI } from "@langchain/openai";
import { getUsableAgentLlmConfig } from "../agent/config.js";
import type { HostContext } from "../host/host-adapter.js";
import type { RegionSummaryRequest, RegionSummaryResponse } from "../contracts.js";
import { getSummaryLlmConfig, getUsableSummaryLlmConfig, type UsableSummaryLlmConfig } from "./config.js";

export type RegionSummaryModelSource = "summary" | "agent";

export interface UsableRegionSummaryModelConfig extends UsableSummaryLlmConfig {
  source: RegionSummaryModelSource;
}

export interface RegionSummaryChatModel {
  invoke(messages: unknown[], options?: { signal?: AbortSignal }): Promise<unknown>;
}

export type RegionSummaryFailureCode = "region_summary_auth_failed" | "region_summary_failed";

export async function resolveRegionSummaryModelConfig(
  hostContext?: HostContext,
  signal?: AbortSignal
): Promise<
  | { ok: true; config: UsableRegionSummaryModelConfig }
  | { ok: false; code: "summary_llm_requires_vision" | "missing_region_summary_config"; message: string }
> {
  const summaryView = getSummaryLlmConfig(hostContext);
  if (summaryView.configured) {
    const summaryConfig = await getUsableSummaryLlmConfig(hostContext, signal);
    if (!summaryConfig?.supportsVision) {
      return {
        ok: false,
        code: "summary_llm_requires_vision",
        message: "Summary LLM must support vision input for region summary."
      };
    }
    return { ok: true, config: { ...summaryConfig, source: "summary" } };
  }

  const agentConfig = await getUsableAgentLlmConfig(hostContext, signal);
  if (agentConfig?.supportsVision) {
    return { ok: true, config: { ...agentConfig, source: "agent" } };
  }

  return {
    ok: false,
    code: "missing_region_summary_config",
    message: "Configure a vision-capable Summary LLM, or leave Summary LLM empty and configure a vision-capable Agent LLM."
  };
}

export function createRegionSummaryChatModel(config: UsableRegionSummaryModelConfig): RegionSummaryChatModel {
  return new ChatOpenAI({
    apiKey: config.apiKey,
    configuration: config.baseUrl ? { baseURL: config.baseUrl } : undefined,
    maxRetries: 1,
    model: config.model,
    temperature: 0,
    timeout: config.timeoutMs
  }) as unknown as RegionSummaryChatModel;
}

export async function summarizeImageRegion(input: {
  request: RegionSummaryRequest;
  config: UsableRegionSummaryModelConfig;
  model?: RegionSummaryChatModel;
  signal?: AbortSignal;
}): Promise<RegionSummaryResponse> {
  const model = input.model ?? createRegionSummaryChatModel(input.config);
  const locale = input.request.locale ?? "zh-CN";
  const prompt =
    locale === "zh-CN"
      ? "你会看到用户点击或框选后的局部裁剪图。只描述裁剪区域里的可见主体，返回 JSON：{\"label\":\"短标签\",\"description\":\"一句事实描述\"}。不要写改图指令，不要臆测裁剪外内容。label 最多 12 个中文字符。"
      : "You will see a crop from a user-selected image region. Describe only the visible subject in the crop and return JSON: {\"label\":\"short label\",\"description\":\"one factual sentence\"}. Do not write edit instructions or infer content outside the crop. Keep label under 6 words.";

  const response = await model.invoke(
    [
      {
        role: "system",
        content: prompt
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: regionContextText(input.request)
          },
          {
            type: "image_url",
            image_url: {
              url: input.request.image.dataUrl
            }
          }
        ]
      }
    ],
    { signal: input.signal }
  );

  return normalizeRegionSummaryResponse(extractMessageText(response), locale);
}

export function regionSummaryFailureCode(error: unknown): RegionSummaryFailureCode {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  if (
    /\b(401|403)\b/u.test(normalized) ||
    normalized.includes("invalid token") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("authentication") ||
    normalized.includes("api key")
  ) {
    return "region_summary_auth_failed";
  }

  return "region_summary_failed";
}

function regionContextText(request: RegionSummaryRequest): string {
  const region = request.region;
  return [
    `Source image: ${request.source.width}x${request.source.height}`,
    `Normalized region: x=${region.x.toFixed(4)}, y=${region.y.toFixed(4)}, width=${region.width.toFixed(4)}, height=${region.height.toFixed(4)}`,
    "Return JSON only."
  ].join("\n");
}

export function normalizeRegionSummaryResponse(text: string, locale: "zh-CN" | "en" = "zh-CN"): RegionSummaryResponse {
  const trimmed = text.trim();
  const parsed = parseFirstJsonObject(trimmed);
  if (parsed) {
    const label = compactLabel(stringValue(parsed.label), locale);
    const description = compactDescription(stringValue(parsed.description));
    if (label) {
      return { label, description };
    }
  }

  const fallback = compactLabel(trimmed.replace(/^["'`]+|["'`]+$/gu, ""), locale);
  return {
    label: fallback || (locale === "zh-CN" ? "选中区域" : "selected region"),
    description: ""
  };
}

function extractMessageText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const content = (value as { content?: unknown })?.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("")
      .trim();
  }

  return "";
}

function parseFirstJsonObject(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function compactLabel(value: string | undefined, locale: "zh-CN" | "en"): string {
  const normalized = (value ?? "").replace(/[\r\n{}]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return "";
  }

  return locale === "zh-CN" ? normalized.slice(0, 24) : normalized.split(" ").slice(0, 6).join(" ").slice(0, 48);
}

function compactDescription(value: string | undefined): string {
  return (value ?? "").replace(/[\r\n]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 180);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

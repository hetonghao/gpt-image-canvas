import OpenAI, { APIConnectionTimeoutError, APIError, APIUserAbortError, toFile } from "openai";
import type { Image, ImageEditParamsNonStreaming, ImageGenerateParamsNonStreaming, ImagesResponse } from "openai/resources/images";
import {
  IMAGE_MODEL,
  type ImageQuality,
  type ImageSize,
  type OutputFormat,
  type ProviderSourceId,
  type ReferenceImageInput,
  type ResolutionTier,
  resolutionTierForSize
} from "../../domain/contracts.js";

export interface ImageProviderInput {
  originalPrompt: string;
  clientRequestId?: string;
  presetId: string;
  prompt: string;
  size: ImageSize;
  sizeApiValue: string;
  quality: ImageQuality;
  outputFormat: OutputFormat;
  count: number;
}

export interface EditImageProviderInput extends ImageProviderInput {
  referenceImages: ReferenceImageInput[];
  referenceImage?: ReferenceImageInput;
  referenceAssetIds?: string[];
  referenceAssetId?: string;
}

export interface ProviderImage {
  b64Json: string;
}

export interface ProviderResult {
  model: string;
  size: string;
  retryCount?: number;
  images: ProviderImage[];
}

export interface ImageProvider {
  readonly sourceId?: ProviderSourceId;
  resolveModelRoute?(size: ImageSize): ImageModelRoute;
  generate(input: ImageProviderInput, signal?: AbortSignal): Promise<ProviderResult>;
  edit(input: EditImageProviderInput, signal?: AbortSignal): Promise<ProviderResult>;
}

export type ProviderErrorCode = "missing_api_key" | "missing_provider" | "unsupported_provider_behavior" | "upstream_failure";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly status: number,
    readonly retryCount?: number
  ) {
    super(message);
  }
}

export interface OpenAIImageProviderConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  model2K?: string;
  model4K?: string;
  timeoutMs: number;
}

export interface ImageModelRoute {
  tier: ResolutionTier;
  model: string;
  fallbackToDefault: boolean;
}

export const DEFAULT_OPENAI_IMAGE_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_PROVIDER_IMAGE_BYTES = 100 * 1024 * 1024;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const AI_COVE_RETRY_COUNT_HEADER = "x-ai-cove-retry-count";

type FlexibleImageGenerateParams = Omit<ImageGenerateParamsNonStreaming, "size"> & {
  size: string;
};

type FlexibleImageEditParams = Omit<ImageEditParamsNonStreaming, "size"> & {
  size: string;
};

export function getOpenAIImageProviderConfig():
  | {
      ok: true;
      config: OpenAIImageProviderConfig;
    }
  | {
      ok: false;
      error: ProviderError;
    } {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: new ProviderError("missing_api_key", "服务器缺少 OPENAI_API_KEY，无法生成图像。", 500)
    };
  }

  const baseURL = process.env.OPENAI_BASE_URL?.trim();

  return {
    ok: true,
    config: {
      apiKey,
      baseURL: baseURL || undefined,
      model: getConfiguredImageModel(),
      timeoutMs: parseOpenAIImageTimeoutMs(process.env.OPENAI_IMAGE_TIMEOUT_MS)
    }
  };
}

export function getConfiguredImageModel(): string {
  return process.env.OPENAI_IMAGE_MODEL?.trim() || IMAGE_MODEL;
}

export function parseOpenAIImageTimeoutMs(value: string | undefined): number {
  return parsePositiveInteger(value, DEFAULT_OPENAI_IMAGE_TIMEOUT_MS);
}

export function resolveImageModelRoute(size: ImageSize, config: Pick<OpenAIImageProviderConfig, "model" | "model2K" | "model4K">): ImageModelRoute {
  const tier = resolutionTierForSize(size);
  const configuredModel = tier === "2K" ? config.model2K : tier === "4K" ? config.model4K : config.model;
  return {
    tier,
    model: configuredModel?.trim() || config.model,
    fallbackToDefault: tier !== "1K" && !configuredModel?.trim()
  };
}

export function createOpenAIImageProvider(config: OpenAIImageProviderConfig, sourceId?: ProviderSourceId): ImageProvider {
  return new OpenAIImageProvider(config, sourceId);
}

class OpenAIImageProvider implements ImageProvider {
  private readonly client: OpenAI;

  constructor(
    private readonly config: OpenAIImageProviderConfig,
    readonly sourceId?: ProviderSourceId
  ) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: 0,
      timeout: config.timeoutMs
    });
  }

  resolveModelRoute(size: ImageSize): ImageModelRoute {
    return resolveImageModelRoute(size, this.config);
  }

  async generate(input: ImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    const model = resolveImageModelRoute(input.size, this.config).model;
    if (isAiCoveCompatibleBaseUrl(this.config.baseURL)) {
      return this.generateViaCompatibleJsonEndpoint(input, model, signal);
    }

    try {
      const response = await this.client.images.generate(
        imageGenerateRequestBody({
          model,
          prompt: input.prompt,
          size: input.sizeApiValue,
          quality: input.quality,
          output_format: input.outputFormat,
          n: input.count
        }),
        { signal }
      ).withResponse();

      return await normalizeProviderResponse(
        response.data,
        input.sizeApiValue,
        model,
        signal,
        retryCountFromHeaders(response.response.headers)
      );
    } catch (error) {
      throw toProviderError(error);
    }
  }

  async edit(input: EditImageProviderInput, signal?: AbortSignal): Promise<ProviderResult> {
    const model = resolveImageModelRoute(input.size, this.config).model;
    try {
      const references = await Promise.all(input.referenceImages.map((referenceImage) => dataUrlToFile(referenceImage)));
      const response = await this.client.images.edit(
        imageEditRequestBody({
          model,
          image: references,
          prompt: input.prompt,
          size: input.sizeApiValue,
          quality: input.quality,
          output_format: input.outputFormat,
          n: input.count
        }),
        { signal }
      ).withResponse();

      return await normalizeProviderResponse(
        response.data,
        input.sizeApiValue,
        model,
        signal,
        retryCountFromHeaders(response.response.headers)
      );
    } catch (error) {
      throw toProviderError(error);
    }
  }

  private async generateViaCompatibleJsonEndpoint(input: ImageProviderInput, model: string, signal?: AbortSignal): Promise<ProviderResult> {
    const timeout = timeoutSignal(signal, this.config.timeoutMs);
    try {
      const response = await fetch(`${trimmedBaseUrl(this.config.baseURL)}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          prompt: input.prompt,
          size: input.sizeApiValue,
          quality: input.quality,
          output_format: input.outputFormat,
          response_format: "b64_json",
          n: input.count
        }),
        signal: timeout.signal
      }).catch((error: unknown) => {
        throw toProviderError(error);
      });

      const bodyText = await response.text();
      const parsed = parseImagesResponseLike(bodyText);
      const retryCount = retryCountFromHeaders(response.headers);
      if (!response.ok) {
        throw providerHttpErrorFromBody(response.status, bodyText, this.config.baseURL, retryCount);
      }
      if (!parsed) {
        throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务返回了无法识别的响应。", 502, retryCount);
      }

      return await normalizeProviderResponse(parsed, input.sizeApiValue, model, timeout.signal, retryCount);
    } finally {
      timeout.cleanup();
    }
  }
}

function imageGenerateRequestBody(body: FlexibleImageGenerateParams): ImageGenerateParamsNonStreaming {
  // The SDK's image size union can lag gpt-image-2's documented flexible-size support.
  return body as unknown as ImageGenerateParamsNonStreaming;
}

function imageEditRequestBody(body: FlexibleImageEditParams): ImageEditParamsNonStreaming {
  // The SDK's image size union can lag gpt-image-2's documented flexible-size support.
  return body as unknown as ImageEditParamsNonStreaming;
}

function toProviderError(error: unknown): Error {
  if (isAbortError(error)) {
    return error;
  }

  if (error instanceof ProviderError) {
    return error;
  }

  if (error instanceof APIConnectionTimeoutError) {
    return new ProviderError("upstream_failure", "OpenAI 图像服务请求超时，请稍后重试或降低分辨率。", 504);
  }

  if (error instanceof APIError) {
    const status = providerHttpStatus(error.status);
    return new ProviderError(
      "upstream_failure",
      stableProviderFailureMessage(status),
      status,
      error.headers ? retryCountFromHeaders(error.headers) : undefined
    );
  }

  if (error instanceof Error) {
    return new ProviderError("upstream_failure", stableProviderFailureMessage(502), 502);
  }

  return new ProviderError("upstream_failure", "OpenAI 图像服务请求失败。", 502);
}

function providerHttpStatus(status: number | undefined): number {
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isAbortError(error: unknown): error is Error {
  return error instanceof APIUserAbortError || (error instanceof DOMException && error.name === "AbortError");
}

async function normalizeProviderResponse(
  response: ImagesResponse,
  sizeApiValue: string,
  model: string,
  signal?: AbortSignal,
  retryCount?: number
): Promise<ProviderResult> {
  if (!Array.isArray(response.data) || response.data.length === 0) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务没有返回图像结果。", 502, retryCount);
  }

  const images = await Promise.all(response.data.map((item) => providerImageFromResponseItem(item, signal, retryCount)));

  if (images.some((image) => !image.b64Json)) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务没有返回 base64 图像数据。", 502, retryCount);
  }

  return {
    model,
    size: sizeApiValue,
    retryCount,
    images
  };
}

function retryCountFromHeaders(headers: Headers): number | undefined {
  const value = headers.get(AI_COVE_RETRY_COUNT_HEADER)?.trim();
  if (!value || !/^\d+$/u.test(value)) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseImagesResponseLike(value: unknown): ImagesResponse | undefined {
  if (typeof value === "string") {
    try {
      return parseImagesResponseLike(JSON.parse(value) as unknown);
    } catch {
      return undefined;
    }
  }

  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { data?: unknown[] }).data)
  ) {
    return value as ImagesResponse;
  }

  return undefined;
}

function parseJsonObjectLike(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      return parseJsonObjectLike(JSON.parse(value) as unknown);
    } catch {
      return undefined;
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function isAiCoveCompatibleBaseUrl(baseURL: string | undefined): boolean {
  const normalized = baseURL?.trim();
  if (!normalized) {
    return false;
  }

  try {
    const host = new URL(normalized).host.toLowerCase();
    return host === "ai-cove.com" || host === "api.ai-cove.com" || host === "long-api.ai-cove.com" || host === "host.docker.internal:8080" || host === "127.0.0.1:8080";
  } catch {
    const lower = normalized.toLowerCase();
    return lower.includes("://ai-cove.com") || lower.includes("://api.ai-cove.com") || lower.includes("://long-api.ai-cove.com") || lower.includes("host.docker.internal:8080") || lower.includes("127.0.0.1:8080");
  }
}

function isAiCoveLongApiBaseUrl(baseURL: string | undefined): boolean {
  const normalized = baseURL?.trim();
  if (!normalized) {
    return false;
  }

  try {
    return new URL(normalized).host.toLowerCase() === "long-api.ai-cove.com";
  } catch {
    return normalized.toLowerCase().includes("://long-api.ai-cove.com");
  }
}

function trimmedBaseUrl(baseURL: string | undefined): string {
  return (baseURL ?? "").replace(/\/+$/u, "");
}

function providerHttpErrorFromBody(status: number, bodyText: string, baseURL?: string, retryCount?: number): ProviderError {
  const parsed = parseJsonObjectLike(bodyText);
  if (status === 403 && !parsed) {
    return new ProviderError("upstream_failure", "AI Cove 网关拒绝了图像请求（HTTP 403）。请检查该 API Key 的额度、分组图片权限或可用性。", 403, retryCount);
  }
  if (status === 524 && !parsed && isAiCoveLongApiBaseUrl(baseURL)) {
    return new ProviderError("upstream_failure", "AI Cove 网关请求超时（HTTP 524）。这通常表示图像生成耗时过长，请稍后重试或降低分辨率。", 524, retryCount);
  }

  const fallbackMessage = `OpenAI 图像服务请求失败（HTTP ${status}）。`;
  if (!parsed) {
    return new ProviderError("upstream_failure", fallbackMessage, providerHttpStatus(status), retryCount);
  }

  return new ProviderError("upstream_failure", providerFailureMessageFromBody(status, parsed), providerHttpStatus(status), retryCount);
}

function providerFailureMessageFromBody(status: number, body: Record<string, unknown>): string {
  if (status !== 400 && status !== 422) {
    return stableProviderFailureMessage(status);
  }

  const error = Reflect.get(body, "error");
  const errorDetails = error !== null && typeof error === "object" ? error : undefined;
  const text = [
    Reflect.get(body, "message"),
    Reflect.get(body, "code"),
    typeof error === "string" ? error : undefined,
    errorDetails ? Reflect.get(errorDetails, "message") : undefined,
    errorDetails ? Reflect.get(errorDetails, "code") : undefined,
    errorDetails ? Reflect.get(errorDetails, "type") : undefined,
    errorDetails ? Reflect.get(errorDetails, "param") : undefined
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (/\bmodel\b|模型/u.test(text)) {
    return `OpenAI 图像服务无法使用当前模型（HTTP ${status}）。请检查所选模型是否支持图像生成。`;
  }
  if (/\b(size|width|height|dimension|resolution)\b|尺寸|分辨率|宽度|高度/u.test(text)) {
    return `OpenAI 图像服务不支持当前尺寸（HTTP ${status}）。请调整输出分辨率后重试。`;
  }
  if (/content[_ -]?policy|safety|moderation|blocked|\bprompt\b|内容策略|安全策略|审核|提示词/u.test(text)) {
    return `当前提示词或内容未通过图像服务校验（HTTP ${status}）。请调整内容后重试。`;
  }
  if (/\b(format|mime|base64|encoding)\b|response_format|格式|编码/u.test(text)) {
    return `OpenAI 图像服务不支持当前输出格式（HTTP ${status}）。请调整格式后重试。`;
  }
  if (/\b(quota|billing|credit|balance|rate limit)\b|额度|余额|计费|欠费/u.test(text)) {
    return `OpenAI 图像服务额度不足或达到请求限制（HTTP ${status}）。请检查额度后重试。`;
  }
  if (/\b(permission|forbidden|unauthorized|api key|group)\b|权限|密钥|分组|认证/u.test(text)) {
    return `OpenAI 图像服务无权执行当前请求（HTTP ${status}）。请检查 API Key、分组权限和模型可用性。`;
  }

  return stableProviderFailureMessage(status);
}

function stableProviderFailureMessage(status: number): string {
  if (status === 400 || status === 422) {
    return `OpenAI 图像服务拒绝了当前请求（HTTP ${status}）。请检查提示词、尺寸、格式或模型参数后重试。`;
  }
  if (status === 401) {
    return "OpenAI 图像服务认证失败（HTTP 401）。请检查当前生成源的 API Key。";
  }
  if (status === 403) {
    return "OpenAI 图像服务拒绝访问（HTTP 403）。请检查额度、分组图片权限或模型可用性。";
  }
  if (status === 408 || status === 504 || status === 524) {
    return `OpenAI 图像服务请求超时（HTTP ${status}）。请稍后重试或降低分辨率。`;
  }
  if (status === 409 || status === 429) {
    return `OpenAI 图像服务暂时无法处理请求（HTTP ${status}）。请稍后重试并检查额度或并发限制。`;
  }
  return `OpenAI 图像服务请求失败（HTTP ${status}）。请稍后重试。`;
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = (): void => controller.abort(signal?.reason);

  if (signal?.aborted) {
    abort();
  } else if (signal) {
    signal.addEventListener("abort", abort, { once: true });
  }

  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}

async function providerImageFromResponseItem(item: Image, signal?: AbortSignal, retryCount?: number): Promise<ProviderImage> {
  if (typeof item.b64_json === "string" && item.b64_json) {
    return {
      b64Json: item.b64_json
    };
  }

  if (typeof item.url === "string" && item.url) {
    return {
      b64Json: await downloadProviderImageUrl(item.url, signal, retryCount)
    };
  }

  return {
    b64Json: ""
  };
}

async function downloadProviderImageUrl(url: string, signal?: AbortSignal, retryCount?: number): Promise<string> {
  const parsedUrl = parseProviderImageUrl(url);
  if (!parsedUrl) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像服务返回的图片 URL 不受支持。", 502, retryCount);
  }

  if (parsedUrl.protocol === "data:") {
    return dataUrlToBase64(url, retryCount);
  }

  const response = await fetch(parsedUrl, { signal }).catch((error: unknown) => {
    if (isAbortError(error)) throw error;
    throw new ProviderError("upstream_failure", "OpenAI 图像 URL 下载失败。", 502, retryCount);
  });
  if (!response.ok) {
    throw new ProviderError("upstream_failure", "OpenAI 图像 URL 下载失败。", providerHttpStatus(response.status), retryCount);
  }

  if (!isProviderImageContentType(response.headers.get("content-type"))) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的内容不是图片。", 502, retryCount);
  }

  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength !== undefined && contentLength > MAX_PROVIDER_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的文件过大。", 502, retryCount);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PROVIDER_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的文件过大。", 502, retryCount);
  }
  if (!isProviderImageBytes(bytes)) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 返回的内容不是可识别的图片。", 502, retryCount);
  }

  return bytes.toString("base64");
}

function parseProviderImageUrl(url: string): URL | undefined {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:" || parsedUrl.protocol === "data:"
      ? parsedUrl
      : undefined;
  } catch {
    return undefined;
  }
}

function dataUrlToBase64(url: string, retryCount?: number): string {
  const match = /^data:[^;,]+;base64,(.+)$/u.exec(url);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "OpenAI 图像 URL 不包含有效的 data URL。", 502, retryCount);
  }

  return match[1];
}

function parseContentLength(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function isProviderImageContentType(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "image/png" || mediaType === "image/jpeg" || mediaType === "image/jpg" || mediaType === "image/webp";
}

function isProviderImageBytes(bytes: Buffer): boolean {
  if (bytes.length < 12) {
    return false;
  }

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return true;
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    return true;
  }

  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return true;
  }

  return false;
}

async function dataUrlToFile(input: ReferenceImageInput): Promise<File> {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(input.dataUrl);
  if (!match) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像格式不受支持。", 400);
  }

  const mimeType = match[1].toLowerCase();
  if (!SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType)) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像必须是 PNG、JPEG 或 WebP 格式。", 400);
  }

  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new ProviderError("unsupported_provider_behavior", "参考图像不能超过 50MB。", 400);
  }

  const normalizedMimeType = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  const extension = normalizedMimeType === "image/png" ? "png" : normalizedMimeType === "image/webp" ? "webp" : "jpg";
  return toFile(bytes, input.fileName?.trim() || `reference.${extension}`, { type: normalizedMimeType });
}

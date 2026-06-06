import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  PromptPoolAuthor,
  PromptPoolItem,
  PromptPoolMediaType,
  PromptPoolResponse,
  PromptPoolStats,
  PromptPoolSummary
} from "@gpt-image-canvas/shared";
import { runtimePaths } from "../../infrastructure/runtime.js";

const EMPTY_SUMMARY: PromptPoolSummary = {
  promptCount: 0,
  imagePromptCount: 0,
  videoPromptCount: 0,
  assetCount: 0
};

let cachedPool:
  | {
      mtimeMs: number;
      promptsPath: string;
      response: PromptPoolResponse;
    }
  | undefined;

export async function getPromptPool(): Promise<PromptPoolResponse> {
  try {
    const { promptsPath, promptsStat, summaryPath } = await resolvePromptPoolFiles();
    const promptsMtimeMs = Number(promptsStat.mtimeMs);
    if (cachedPool && cachedPool.promptsPath === promptsPath && cachedPool.mtimeMs === promptsMtimeMs) {
      return cachedPool.response;
    }

    const [promptsBuffer, summaryBuffer] = await Promise.all([
      readFile(promptsPath, "utf8"),
      readOptionalText(summaryPath)
    ]);
    const rawPrompts = JSON.parse(promptsBuffer) as unknown;
    if (!Array.isArray(rawPrompts)) {
      return unavailablePool("prompt_pool_invalid");
    }

    const rawSummary = parseOptionalJson(summaryBuffer);
    const rawBase = normalizeRawBase(rawSummary);
    const response: PromptPoolResponse = {
      available: true,
      items: rawPrompts.flatMap((item) => {
        const normalized = normalizePromptPoolItem(item, rawBase);
        return normalized ? [normalized] : [];
      }),
      summary: normalizeSummary(rawSummary, rawPrompts.length)
    };
    cachedPool = {
      mtimeMs: promptsMtimeMs,
      promptsPath,
      response
    };
    return response;
  } catch {
    return unavailablePool("prompt_pool_missing");
  }
}

async function resolvePromptPoolFiles(): Promise<{ promptsPath: string; promptsStat: Awaited<ReturnType<typeof stat>>; summaryPath: string }> {
  const candidateDirs = [runtimePaths.promptPoolDir, resolve(runtimePaths.promptPoolDir, "data")];

  for (const candidateDir of candidateDirs) {
    const promptsPath = resolve(candidateDir, "prompts-all.json");
    try {
      return {
        promptsPath,
        promptsStat: await stat(promptsPath),
        summaryPath: resolve(candidateDir, "summary.json")
      };
    } catch {
      // Try the next supported layout.
    }
  }

  throw new Error("Prompt pool data was not found.");
}

function unavailablePool(errorCode: PromptPoolResponse["errorCode"]): PromptPoolResponse {
  return {
    available: false,
    errorCode,
    items: [],
    summary: EMPTY_SUMMARY
  };
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function parseOptionalJson(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function normalizePromptPoolItem(value: unknown, rawBase: string): PromptPoolItem | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readString(value.id);
  const prompt = readString(value.prompt);
  if (!id || !prompt) {
    return undefined;
  }

  const relativeImages = [
    ...readStringArray(value.cdnImages),
    ...readStringArray(value.localImages),
    readString(value.cdnImage)
  ].filter(isDefined);
  const rawImages = uniqueStrings([
    ...readStringArray(value.rawImages).filter(isGithubRawImageUrl),
    ...relativeImages.flatMap((assetPath) => {
      const rawUrl = githubRawUrlForAssetPath(rawBase, assetPath);
      return rawUrl ? [rawUrl] : [];
    })
  ]);
  const rawImage = readString(value.rawImage);
  const assetUrl = isGithubRawImageUrl(rawImage) ? rawImage : firstString(rawImages);
  if (!assetUrl) {
    return undefined;
  }

  const mediaType = normalizeMediaType(value.mediaType);
  const title = readString(value.title) || promptExcerpt(prompt, 84);
  const width = readPositiveNumber(value.imageWidth);
  const height = readPositiveNumber(value.imageHeight);

  return {
    id,
    title,
    prompt,
    mediaType,
    model: readString(value.model) || (mediaType === "video" ? "Video" : "Image"),
    postedAt: readString(value.postedAt),
    promptReady: value.promptReady === true,
    assetUrl,
    imageCount: Math.max(rawImages.length, 1),
    imageWidth: width,
    imageHeight: height,
    aspectRatio: readString(value.aspectRatio) || (width && height ? `${width}:${height}` : undefined),
    author: normalizeAuthor(value.author),
    stats: normalizeStats(value.stats),
    sourceUrl: normalizeSourceUrl(value.author)
  };
}

function normalizeSummary(value: unknown, fallbackCount: number): PromptPoolSummary {
  if (!isRecord(value)) {
    return {
      ...EMPTY_SUMMARY,
      promptCount: fallbackCount
    };
  }

  const sourceSummary = isRecord(value.sourceSummary) ? value.sourceSummary : undefined;
  return {
    builtAt: readString(value.builtAt),
    scrapedAt: readString(sourceSummary?.scrapedAt),
    siteUrl: readString(sourceSummary?.siteUrl),
    promptCount: readNonNegativeInteger(value.promptCount) ?? fallbackCount,
    imagePromptCount: readNonNegativeInteger(value.imagePromptCount) ?? 0,
    videoPromptCount: readNonNegativeInteger(value.videoPromptCount) ?? 0,
    assetCount: readNonNegativeInteger(value.assetCount) ?? 0
  };
}

function normalizeRawBase(value: unknown): string {
  const fallback = "https://raw.githubusercontent.com/mrslimslim/awesome-prompt/main";
  if (!isRecord(value)) {
    return fallback;
  }

  const rawBase = readString(value.rawBase)?.replace(/\/+$/u, "");
  if (!rawBase) {
    return fallback;
  }

  try {
    const url = new URL(rawBase);
    return url.protocol === "https:" && url.hostname === "raw.githubusercontent.com" ? rawBase : fallback;
  } catch {
    return fallback;
  }
}

function normalizeAuthor(value: unknown): PromptPoolAuthor | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const name = readString(value.name);
  if (!name) {
    return undefined;
  }

  return {
    name,
    username: readString(value.username),
    verified: value.verified === true,
    profileUrl: readString(value.profileUrl)
  };
}

function normalizeStats(value: unknown): PromptPoolStats {
  if (!isRecord(value)) {
    return {
      likes: 0,
      views: 0,
      retweets: 0
    };
  }

  return {
    likes: readNonNegativeInteger(value.likes) ?? 0,
    views: readNonNegativeInteger(value.views) ?? 0,
    retweets: readNonNegativeInteger(value.retweets) ?? 0
  };
}

function normalizeSourceUrl(author: unknown): string | undefined {
  if (!isRecord(author)) {
    return undefined;
  }

  const profileUrl = readString(author.profileUrl);
  return profileUrl?.startsWith("https://") ? profileUrl : undefined;
}

function normalizeMediaType(value: unknown): PromptPoolMediaType {
  return value === "video" ? "video" : "image";
}

function githubRawUrlForAssetPath(rawBase: string, value: string): string | undefined {
  const normalized = normalizeRelativeAssetPath(value);
  if (!normalized) {
    return undefined;
  }

  return `${rawBase}/${normalized.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeRelativeAssetPath(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\\/gu, "/").split("?", 1)[0]?.split("#", 1)[0];
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0") || /^[a-z][a-z0-9+.-]*:/iu.test(normalized)) {
    return undefined;
  }

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    return undefined;
  }

  return parts.join("/");
}

function isGithubRawImageUrl(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "raw.githubusercontent.com";
  } catch {
    return false;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function firstString(value: string[]): string | undefined {
  return value[0];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function promptExcerpt(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 3)}...` : compact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  PromptPoolAuthor,
  PromptPoolErrorCode,
  PromptPoolItem,
  PromptPoolItemResponse,
  PromptPoolListItem,
  PromptPoolMediaType,
  PromptPoolModelOption,
  PromptPoolResponse,
  PromptPoolSortMode,
  PromptPoolStats,
  PromptPoolSummary
} from "@gpt-image-canvas/shared";
import { runtimePaths } from "../../infrastructure/runtime.js";

const DEFAULT_PROMPT_POOL_LIMIT = 72;
const MAX_PROMPT_POOL_LIMIT = 144;

const EMPTY_SUMMARY: PromptPoolSummary = {
  promptCount: 0,
  imagePromptCount: 0,
  videoPromptCount: 0,
  assetCount: 0
};

type LoadedPromptPool =
  | {
      available: true;
      items: PromptPoolItem[];
      summary: PromptPoolSummary;
    }
  | {
      available: false;
      errorCode: PromptPoolErrorCode;
    };

export interface PromptPoolListQuery {
  limit?: string | number;
  mediaType?: string;
  model?: string;
  offset?: string | number;
  q?: string;
  sort?: string;
}

let cachedPool:
  | {
      mtimeMs: number;
      pool: LoadedPromptPool;
      promptsPath: string;
    }
  | undefined;

export async function getPromptPool(query: PromptPoolListQuery = {}): Promise<PromptPoolResponse> {
  const pool = await loadPromptPool();
  if (!pool.available) {
    return unavailablePromptPoolResponse(pool.errorCode);
  }

  return toPromptPoolResponse(pool, normalizePromptPoolListQuery(query));
}

export async function getPromptPoolItem(id: string): Promise<PromptPoolItemResponse> {
  const pool = await loadPromptPool();
  if (!pool.available) {
    return pool;
  }

  const normalizedId = id.trim();
  const item = pool.items.find((candidate) => candidate.id === normalizedId);
  if (!item) {
    return {
      available: false,
      errorCode: "prompt_pool_item_not_found"
    };
  }

  return {
    available: true,
    item
  };
}

async function loadPromptPool(): Promise<LoadedPromptPool> {
  try {
    const { promptsPath, promptsStat, summaryPath } = await resolvePromptPoolFiles();
    const promptsMtimeMs = Number(promptsStat.mtimeMs);
    if (cachedPool && cachedPool.promptsPath === promptsPath && cachedPool.mtimeMs === promptsMtimeMs) {
      return cachedPool.pool;
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
    const pool: LoadedPromptPool = {
      available: true,
      items: rawPrompts.flatMap((item) => {
        const normalized = normalizePromptPoolItem(item, rawBase);
        return normalized ? [normalized] : [];
      }),
      summary: normalizeSummary(rawSummary, rawPrompts.length)
    };
    cachedPool = {
      mtimeMs: promptsMtimeMs,
      pool,
      promptsPath
    };
    return pool;
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

function unavailablePool(errorCode: PromptPoolErrorCode): Extract<LoadedPromptPool, { available: false }> {
  return {
    available: false,
    errorCode
  };
}

function unavailablePromptPoolResponse(errorCode: PromptPoolErrorCode): PromptPoolResponse {
  return {
    available: false,
    errorCode,
    items: [],
    limit: DEFAULT_PROMPT_POOL_LIMIT,
    modelOptions: [],
    nextOffset: null,
    offset: 0,
    readyCount: 0,
    summary: EMPTY_SUMMARY,
    totalCount: 0
  };
}

function toPromptPoolResponse(
  pool: Extract<LoadedPromptPool, { available: true }>,
  query: NormalizedPromptPoolListQuery
): PromptPoolResponse {
  const searchableItems = filterPromptPoolItemsBySearchAndMedia(pool.items, query);
  const modelOptions = promptPoolModelOptions(searchableItems);
  const filteredItems = filterPromptPoolItemsByModel(searchableItems, query.model);
  const sortedItems = sortPromptPoolItems(filteredItems, query.sort);
  const pageItems = sortedItems.slice(query.offset, query.offset + query.limit);
  const nextOffset = query.offset + query.limit < sortedItems.length ? query.offset + query.limit : null;

  return {
    available: true,
    items: pageItems.map(toPromptPoolListItem),
    limit: query.limit,
    modelOptions,
    nextOffset,
    offset: query.offset,
    readyCount: filteredItems.filter((item) => item.promptReady).length,
    summary: pool.summary,
    totalCount: filteredItems.length
  };
}

interface NormalizedPromptPoolListQuery {
  limit: number;
  mediaType: "all" | PromptPoolMediaType;
  model: string;
  offset: number;
  q: string;
  sort: PromptPoolSortMode;
}

function normalizePromptPoolListQuery(query: PromptPoolListQuery): NormalizedPromptPoolListQuery {
  return {
    limit: readBoundedInteger(query.limit, DEFAULT_PROMPT_POOL_LIMIT, 1, MAX_PROMPT_POOL_LIMIT),
    mediaType: normalizeMediaFilter(query.mediaType),
    model: readString(query.model) ?? "all",
    offset: readBoundedInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER),
    q: readString(query.q) ?? "",
    sort: normalizeSortMode(query.sort)
  };
}

function filterPromptPoolItemsBySearchAndMedia(
  items: PromptPoolItem[],
  query: NormalizedPromptPoolListQuery
): PromptPoolItem[] {
  const normalizedQuery = normalizeSearchText(query.q);

  return items.filter((item) => {
    if (query.mediaType !== "all" && item.mediaType !== query.mediaType) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return normalizeSearchText(
      `${item.title} ${item.prompt} ${item.model} ${item.author?.name ?? ""} ${item.author?.username ?? ""}`
    ).includes(normalizedQuery);
  });
}

function filterPromptPoolItemsByModel(items: PromptPoolItem[], model: string): PromptPoolItem[] {
  return model === "all" ? items : items.filter((item) => item.model === model);
}

function sortPromptPoolItems(items: PromptPoolItem[], sort: PromptPoolSortMode): PromptPoolItem[] {
  if (sort === "latest") {
    return items;
  }

  return [...items].sort((a, b) => {
    if (sort === "ready") {
      return Number(b.promptReady) - Number(a.promptReady) || popularityScore(b) - popularityScore(a);
    }

    return popularityScore(b) - popularityScore(a);
  });
}

function promptPoolModelOptions(items: PromptPoolItem[]): PromptPoolModelOption[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.model, (counts.get(item.model) ?? 0) + 1);
  }

  return Array.from(counts, ([model, count]) => ({ count, model })).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
}

function toPromptPoolListItem(item: PromptPoolItem): PromptPoolListItem {
  const { prompt, ...rest } = item;
  return {
    ...rest,
    promptExcerpt: promptExcerpt(prompt, 96),
    promptLength: prompt.length
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

function normalizeMediaFilter(value: string | undefined): "all" | PromptPoolMediaType {
  return value === "image" || value === "video" ? value : "all";
}

function normalizeSortMode(value: string | undefined): PromptPoolSortMode {
  return value === "popular" || value === "ready" ? value : "latest";
}

function popularityScore(item: PromptPoolItem): number {
  return item.stats.views + item.stats.likes * 24 + item.stats.retweets * 40;
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
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

function readBoundedInteger(value: string | number | undefined, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
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

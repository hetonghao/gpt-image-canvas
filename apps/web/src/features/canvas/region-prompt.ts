import type { AgentLlmConfigView, NormalizedImageRegion, SummaryLlmConfigView } from "@gpt-image-canvas/shared";

export type RegionPromptStatus = "summarizing" | "ready" | "failed";
export type RegionPromptMode = "auto" | "manual";
export type RegionPromptLocale = "zh-CN" | "en";

export interface RegionPromptReference {
  key: string;
  assetId: string | null;
  localAssetId?: string;
  name: string;
  sourceUrl: string;
  width: number;
  height: number;
}

export interface RegionPromptItem {
  id: string;
  mode: RegionPromptMode;
  label: string;
  cropDataUrl?: string;
  cropAspectRatio?: string;
  description: string;
  note: string;
  insertionIndex?: number;
  region: NormalizedImageRegion;
  reference: RegionPromptReference;
  status: RegionPromptStatus;
  error?: string;
}

export interface RegionPromptDocumentEdit {
  prompt: string;
  cursorIndex: number;
  from: number;
  to: number;
  insert: string;
  token: string;
  changed: boolean;
}

export interface RegionPromptDocumentReplacement {
  prompt: string;
  from: number;
  to: number;
  insert: string;
  changed: boolean;
}

export interface RegionPromptTokenRange {
  from: number;
  to: number;
  label: string;
  region: RegionPromptItem;
}

export interface RegionPixelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RegionSummaryAvailability =
  | { status: "ready"; source: "summary" | "agent" }
  | { status: "loading" }
  | { status: "summary-no-vision" }
  | { status: "missing-config" };

const REGION_PROMPT_PENDING_TOKEN_PREFIX = "__region_prompt:";
const REGION_PROMPT_PENDING_TOKEN_PATTERN = /\{__region_prompt:[^{}]+\}/g;

export function regionSummaryAvailability(input: {
  agentConfig: AgentLlmConfigView | null;
  isAgentConfigLoading: boolean;
  isSummaryConfigLoading: boolean;
  summaryConfig: SummaryLlmConfigView | null;
}): RegionSummaryAvailability {
  if (input.isAgentConfigLoading || input.isSummaryConfigLoading) {
    return { status: "loading" };
  }

  if (input.summaryConfig?.configured) {
    return input.summaryConfig.supportsVision ? { status: "ready", source: "summary" } : { status: "summary-no-vision" };
  }

  if (input.agentConfig?.configured && input.agentConfig.supportsVision) {
    return { status: "ready", source: "agent" };
  }

  return { status: "missing-config" };
}

export function defaultRegionForPoint(x: number, y: number, width = 0.24, height = 0.24): NormalizedImageRegion {
  return clampRegion({
    x: x - width / 2,
    y: y - height / 2,
    width,
    height
  });
}

export function regionFromDrag(start: { x: number; y: number }, end: { x: number; y: number }): NormalizedImageRegion {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < 0.02 || height < 0.02) {
    return defaultRegionForPoint(end.x, end.y);
  }
  return clampRegion({ x, y, width, height });
}

export function createManualRegionPromptItem(input: {
  id: string;
  label: string;
  locale?: RegionPromptLocale;
  reference: RegionPromptReference;
  region: NormalizedImageRegion;
}): RegionPromptItem {
  return {
    id: input.id,
    mode: "manual",
    label: input.label.trim(),
    description: regionLocationText(input.region, input.locale),
    note: "",
    region: input.region,
    reference: input.reference,
    status: "ready"
  };
}

export function referencesForRegionPromptItems(items: RegionPromptItem[]): RegionPromptReference[] {
  const references = new Map<string, RegionPromptReference>();
  for (const item of items) {
    if (!references.has(item.reference.key)) {
      references.set(item.reference.key, item.reference);
    }
  }

  return Array.from(references.values());
}

export function promptWithRegionTokens(userPrompt: string, regions: RegionPromptItem[]): string {
  const basePrompt = removeRegionPromptPendingTokens(userPrompt).trim();
  const missingRegions = regions
    .map((region, index) => ({
      index,
      offset: region.insertionIndex ?? basePrompt.length,
      region,
      token: regionPromptToken(region.label)
    }))
    .filter((item) => item.region.label.trim() && !basePrompt.includes(item.token))
    .sort((left, right) => left.offset - right.offset || left.index - right.index);

  return missingRegions
    .reduce(
      (state, item) => {
        const beforeLength = state.prompt.length;
        const insertionIndex = Math.max(0, Math.min(state.prompt.length, item.offset + state.delta));
        const prompt = insertRegionPromptToken(state.prompt, item.region, insertionIndex);
        return {
          prompt,
          delta: state.delta + prompt.length - beforeLength
        };
      },
      { prompt: basePrompt, delta: 0 }
    )
    .prompt.trim();
}

export function appendRegionPromptToken(userPrompt: string, region: RegionPromptItem): string {
  return insertRegionPromptToken(userPrompt, region, userPrompt.length);
}

export function insertRegionPromptToken(userPrompt: string, region: RegionPromptItem, cursorIndex = userPrompt.length): string {
  return insertRegionPromptTokenAtCursor(userPrompt, region, cursorIndex).prompt;
}

export function insertRegionPromptTokenAtCursor(
  userPrompt: string,
  region: RegionPromptItem,
  cursorIndex = userPrompt.length
): { prompt: string; cursorIndex: number } {
  const label = region.label.trim();
  if (!label) {
    return { prompt: userPrompt, cursorIndex: Math.max(0, Math.min(userPrompt.length, cursorIndex)) };
  }

  const edit = insertRegionPromptTokenTextAtCursor(userPrompt, regionPromptToken(label), cursorIndex);
  return {
    prompt: edit.prompt.trim(),
    cursorIndex: Math.max(0, Math.min(edit.prompt.trim().length, edit.cursorIndex))
  };
}

export function insertRegionPromptDocumentTokenAtCursor(
  userPrompt: string,
  region: RegionPromptItem,
  cursorIndex = userPrompt.length
): RegionPromptDocumentEdit {
  return insertRegionPromptTokenTextAtCursor(userPrompt, regionPromptDocumentToken(region), cursorIndex);
}

function insertRegionPromptTokenTextAtCursor(userPrompt: string, token: string, cursorIndex = userPrompt.length): RegionPromptDocumentEdit {
  if (!token) {
    const clampedCursor = Math.max(0, Math.min(userPrompt.length, cursorIndex));
    return {
      prompt: userPrompt,
      cursorIndex: clampedCursor,
      from: clampedCursor,
      to: clampedCursor,
      insert: "",
      token,
      changed: false
    };
  }

  if (userPrompt.includes(token)) {
    const clampedCursor = Math.max(0, Math.min(userPrompt.length, cursorIndex));
    return {
      prompt: userPrompt,
      cursorIndex: clampedCursor,
      from: clampedCursor,
      to: clampedCursor,
      insert: "",
      token,
      changed: false
    };
  }

  const insertionIndex = Math.max(0, Math.min(userPrompt.length, cursorIndex));
  const rawBefore = userPrompt.slice(0, insertionIndex);
  const rawAfter = userPrompt.slice(insertionIndex);
  const before = rawBefore.replace(/[ \t]+$/g, "");
  const after = rawAfter.replace(/^[ \t]+/g, "");
  const from = before.length;
  const to = insertionIndex + (rawAfter.length - after.length);
  const insert = `${before.length > 0 ? " " : ""}${token} `;
  const prompt = `${userPrompt.slice(0, from)}${insert}${userPrompt.slice(to)}`;
  const cursorAfterToken = from + insert.length;
  return {
    prompt,
    cursorIndex: Math.max(0, Math.min(prompt.length, cursorAfterToken)),
    from,
    to,
    insert,
    token,
    changed: true
  };
}

export function removeRegionPromptToken(userPrompt: string, label: string): string {
  const token = regionPromptToken(label.trim());
  if (token === "{}") {
    return userPrompt.trim();
  }

  return normalizePromptTokenWhitespace(userPrompt.replaceAll(token, " "));
}

function normalizePromptTokenWhitespace(userPrompt: string): string {
  return userPrompt
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export function removeRegionPromptItemToken(userPrompt: string, region: RegionPromptItem): string {
  const label = region.label.trim();
  const withoutPending = userPrompt.replaceAll(regionPromptPendingToken(region.id), " ");
  const withoutReady = label ? withoutPending.replaceAll(regionPromptToken(label), " ") : withoutPending;
  return normalizePromptTokenWhitespace(withoutReady);
}

export function removeRegionPromptTokens(userPrompt: string, regions: RegionPromptItem[]): string {
  return regions.reduce((nextPrompt, region) => removeRegionPromptToken(nextPrompt, region.label), userPrompt);
}

export function removeRegionPromptPendingTokens(userPrompt: string): string {
  return normalizePromptTokenWhitespace(userPrompt.replace(REGION_PROMPT_PENDING_TOKEN_PATTERN, " "));
}

export function promptIncludesRegionToken(userPrompt: string, label: string): boolean {
  const trimmedLabel = label.trim();
  return trimmedLabel ? userPrompt.includes(regionPromptToken(trimmedLabel)) : false;
}

export function promptIncludesRegionItemToken(userPrompt: string, region: RegionPromptItem): boolean {
  const label = region.label.trim();
  return userPrompt.includes(regionPromptPendingToken(region.id)) || (label ? promptIncludesRegionToken(userPrompt, label) : false);
}

export function regionPromptToken(label: string): string {
  return `{${label.trim()}}`;
}

export function regionPromptPendingToken(itemId: string): string {
  return `{${REGION_PROMPT_PENDING_TOKEN_PREFIX}${itemId}}`;
}

export function regionPromptDocumentToken(region: RegionPromptItem): string {
  const label = region.label.trim();
  return label ? regionPromptToken(label) : regionPromptPendingToken(region.id);
}

export function replaceRegionPromptPendingToken(userPrompt: string, region: RegionPromptItem): RegionPromptDocumentReplacement {
  const label = region.label.trim();
  const pendingToken = regionPromptPendingToken(region.id);
  const from = userPrompt.indexOf(pendingToken);
  if (!label || from < 0) {
    return {
      prompt: userPrompt,
      from: Math.max(0, from),
      to: Math.max(0, from),
      insert: "",
      changed: false
    };
  }

  const insert = regionPromptToken(label);
  const to = from + pendingToken.length;
  return {
    prompt: `${userPrompt.slice(0, from)}${insert}${userPrompt.slice(to)}`,
    from,
    to,
    insert,
    changed: true
  };
}

export function regionPromptTokenRanges(userPrompt: string, regions: RegionPromptItem[]): RegionPromptTokenRange[] {
  const regionsByLabel = new Map<string, RegionPromptItem>();
  const regionsByPendingToken = new Map<string, RegionPromptItem>();
  for (const region of regions) {
    const label = region.label.trim();
    if (label) {
      regionsByLabel.set(label, region);
    }
    regionsByPendingToken.set(regionPromptPendingToken(region.id), region);
  }

  const ranges: RegionPromptTokenRange[] = [];
  const tokenPattern = /\{([^{}]+)\}/g;
  for (const match of userPrompt.matchAll(tokenPattern)) {
    const token = match[0];
    const label = match[1]?.trim() ?? "";
    const region = regionsByPendingToken.get(token) ?? regionsByLabel.get(label);
    if (!region) {
      continue;
    }

    const from = match.index ?? 0;
    ranges.push({
      from,
      to: from + token.length,
      label: region.label.trim(),
      region
    });
  }

  return ranges;
}

export function clampRegion(region: NormalizedImageRegion): NormalizedImageRegion {
  const width = Math.max(0.02, Math.min(1, region.width));
  const height = Math.max(0.02, Math.min(1, region.height));
  const x = Math.max(0, Math.min(1 - width, region.x));
  const y = Math.max(0, Math.min(1 - height, region.y));
  return { x, y, width, height };
}

export function regionPixelBounds(region: NormalizedImageRegion, source: { width: number; height: number }): RegionPixelBounds {
  const sourceWidth = Math.max(1, Math.round(source.width));
  const sourceHeight = Math.max(1, Math.round(source.height));
  const cropX = Math.max(0, Math.floor(region.x * sourceWidth));
  const cropY = Math.max(0, Math.floor(region.y * sourceHeight));
  return {
    x: cropX,
    y: cropY,
    width: Math.max(1, Math.min(sourceWidth - cropX, Math.ceil(region.width * sourceWidth))),
    height: Math.max(1, Math.min(sourceHeight - cropY, Math.ceil(region.height * sourceHeight)))
  };
}

export function regionPreviewAspectRatio(region: NormalizedImageRegion, source: { width: number; height: number }): string {
  const bounds = regionPixelBounds(region, source);
  return `${bounds.width} / ${bounds.height}`;
}

export function regionPrecisionText(
  region: NormalizedImageRegion,
  source: { width: number; height: number },
  locale: RegionPromptLocale = "en"
): string {
  const sourceWidth = Math.max(1, Math.round(source.width));
  const sourceHeight = Math.max(1, Math.round(source.height));
  const bounds = regionPixelBounds(region, { width: sourceWidth, height: sourceHeight });
  const normalized = `x=${region.x.toFixed(4)}, y=${region.y.toFixed(4)}, width=${region.width.toFixed(4)}, height=${region.height.toFixed(4)}`;
  if (locale === "zh-CN") {
    return `裁剪范围：原图 ${sourceWidth}x${sourceHeight}，x=${bounds.x}，y=${bounds.y}，宽=${bounds.width}，高=${bounds.height}。归一化：${normalized}`;
  }

  return `Crop bounds: source ${sourceWidth}x${sourceHeight}, x=${bounds.x}, y=${bounds.y}, width=${bounds.width}, height=${bounds.height}. Normalized: ${normalized}`;
}

export function buildRegionEnhancedPrompt(userPrompt: string, regions: RegionPromptItem[], locale: RegionPromptLocale = "en"): string {
  const usableRegions = regions.filter((region) => region.label.trim());
  if (usableRegions.length === 0) {
    return userPrompt.trim();
  }

  const referenceIndexes = new Map(referencesForRegionPromptItems(usableRegions).map((reference, index) => [reference.key, index + 1]));
  const referenceLines = usableRegions.map((region, index) => {
    const label = region.label.trim();
    const description = region.description.trim();
    const note = region.note.trim();
    const referenceIndex = referenceIndexes.get(region.reference.key) ?? index + 1;
    const precision = regionPrecisionText(region.region, region.reference, locale);
    if (locale === "zh-CN") {
      return `${index + 1}. 参考图 ${referenceIndex} {${label}}：${description || regionLocationText(region.region, locale)}。${precision}${note ? ` 用户备注：${note}` : ""}`;
    }

    return [
      `${index + 1}. Reference image ${referenceIndex} {${label}}:`,
      description || regionLocationText(region.region),
      precision,
      note ? `User note: ${note}` : ""
    ]
      .filter(Boolean)
      .join(" ");
  });

  if (locale === "zh-CN") {
    return [
      "直接编辑所选参考图。保持原始构图、透视、光线和无关区域不变。",
      "",
      "用户需求：",
      userPrompt.trim(),
      "",
      "区域参考：",
      ...referenceLines,
      "",
      "只把修改应用到命名区域。不要生成无关的新图。"
    ].join("\n");
  }

  return [
    "Edit the selected reference image directly. Preserve the original composition, perspective, lighting, and unrelated areas.",
    "",
    "User request:",
    userPrompt.trim(),
    "",
    "Region references:",
    ...referenceLines,
    "",
    "Apply only the requested changes to the named regions. Do not create an unrelated replacement image."
  ].join("\n");
}

export function finalRegionPromptForModel(userPrompt: string, regions: RegionPromptItem[], locale: RegionPromptLocale = "en"): string {
  return buildRegionEnhancedPrompt(promptWithRegionTokens(userPrompt, regions), regions, locale);
}

export function regionLocationText(region: NormalizedImageRegion, locale: RegionPromptLocale = "en"): string {
  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;
  const horizontal = regionAxisPosition(centerX, "left", "center", "right");
  const vertical = regionAxisPosition(centerY, "top", "middle", "bottom");
  if (locale === "zh-CN") {
    const zhPositions: Record<string, string> = {
      "bottom-center": "下方",
      "bottom-left": "左下方",
      "bottom-right": "右下方",
      "middle-center": "中央",
      "middle-left": "左侧",
      "middle-right": "右侧",
      "top-center": "上方",
      "top-left": "左上方",
      "top-right": "右上方"
    };
    return `画面${zhPositions[`${vertical}-${horizontal}`] ?? "中"}的选中区域`;
  }

  return `${vertical} ${horizontal} selected area`;
}

function regionAxisPosition(value: number, low: string, middle: string, high: string): string {
  if (value < 0.34) {
    return low;
  }
  if (value > 0.66) {
    return high;
  }
  return middle;
}

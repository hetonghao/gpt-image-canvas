import {
  AlertTriangle,
  Bot,
  BookOpenCheck,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  History,
  ImageIcon,
  KeyRound,
  Loader2,
  LogOut,
  MapPin,
  MessageCirclePlus,
  RotateCcw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  X,
  XCircle
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  DefaultSnapIndicator,
  Tldraw,
  type Editor,
  type TLAsset,
  type TLAssetContext,
  type TLAssetId,
  type TLAssetStore,
  type TLEditorSnapshot,
  type TLImageShape,
  type TLShapePartial,
  type TLShapeId,
  type TLStoreSnapshot,
  type TLComponents,
  type TldrawOptions,
  type TLUserPreferences,
  type TLSnapIndicatorProps,
  useIsDarkMode,
  useEditor,
  useTldrawUser,
  useValue
} from "tldraw";
import {
  GENERATION_PLACEHOLDER_TYPE,
  GenerationPlaceholderShapeUtil,
  type GenerationPlaceholderShape
} from "./GenerationPlaceholderShape";
import {
  AGENT_PLAN_NODE_TYPE,
  AgentPlanNodeShapeUtil,
  hasFailedPlanJob,
  isAgentPlanNodeShape,
  isGenerationPlan,
  summarizeGenerationPlanOutputs
} from "../agent/AgentPlanNodeShape";
import type { PromptRegionEditorHandle } from "./PromptRegionEditor";
import { generationSubmitActionForProviderState, shouldAutoOpenProviderOnboarding } from "./provider-onboarding";
import { initialRouteForCurrentRuntime, isAiCoveEmbeddedRuntime, pathForRoute, routeFromLocation, type AppRoute } from "./runtime-route";
import {
  CUSTOM_SIZE_PRESET_ID,
  GENERATION_COUNTS,
  IMAGE_SIZE_MULTIPLE,
  IMAGE_QUALITIES,
  MAX_AGENT_SELECTED_REFERENCES,
  MAX_IMAGE_ASPECT_RATIO,
  MAX_IMAGE_DIMENSION,
  MAX_REFERENCE_IMAGES,
  MAX_TOTAL_PIXELS,
  MIN_IMAGE_DIMENSION,
  MIN_TOTAL_PIXELS,
  OUTPUT_FORMATS,
  SIZE_PRESETS,
  STYLE_PRESETS,
  isHostedAiCoveAdapterMode,
  resolutionTierForSize,
  validateImageSize,
  type AgentConversation,
  type AgentConversationListResponse,
  type AgentConversationMessage,
  type AgentConversationSummary,
  type AgentLlmConfigView,
  type AgentPlannerOptions,
  type AgentReasoningEffort,
  type AgentSelectedCanvasReference,
  type AgentServerEvent,
  type AgentThinkingType,
  type AuthStatusResponse,
  type AssetMetadataResponse,
  type CloudStorageProvider,
  type CodexDevicePollResponse,
  type CodexDeviceStartResponse,
  type CodexLogoutResponse,
  type GalleryImageItem,
  type GenerationCount,
  type GenerationJob,
  type GenerationPlan,
  type GenerationRecord,
  type GenerationReference,
  type GenerationResponse,
  type GenerationStatus,
  type GeneratedAsset,
  type ImageQuality,
  type ImageSize,
  type ImageSizeValidationReason,
  type NormalizedImageRegion,
  type OutputFormat,
  type ProjectState,
  type ReferenceImageInput,
  type ResolutionTier,
  type RegionSummaryRequest,
  type RegionSummaryResponse,
  type SaveStorageConfigRequest,
  type S3EndpointMode,
  type SizePreset,
  type StorageConfigResponse,
  type StorageTestResult,
  type SummaryLlmConfigView,
  type StylePresetId
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";
import { normalizeAssetUrl } from "../../shared/api/asset-url";
import { assetDownloadUrl, assetPreviewUrl } from "../../shared/api/assets";
import { apiFetch, appendHostTokenParam } from "../../shared/api/host-token";
import {
  createManualRegionPromptItem,
  defaultRegionForPoint,
  finalRegionPromptForModel,
  insertRegionPromptDocumentTokenAtCursor,
  promptIncludesRegionItemToken,
  promptWithRegionTokens,
  removeRegionPromptItemToken,
  removeRegionPromptPendingTokens,
  referencesForRegionPromptItems,
  regionPixelBounds,
  regionPrecisionText,
  regionPreviewAspectRatio,
  removeRegionPromptTokens,
  replaceRegionPromptPendingToken,
  regionSummaryAvailability,
  type RegionPromptReference,
  type RegionPromptItem,
  type RegionSummaryAvailability
} from "./region-prompt";
import { referenceAssetIdsForRequest, shouldSendReferenceImages } from "./reference-request";

const AUTOSAVE_DEBOUNCE_MS = 1200;
const GENERATION_POLL_INTERVAL_MS = 1500;
const AGENT_SOCKET_PING_INTERVAL_MS = 15_000;
const AGENT_SOCKET_RECONNECT_INITIAL_MS = 500;
const AGENT_SOCKET_RECONNECT_MAX_MS = 10_000;
const AGENT_SOCKET_RECONNECT_WINDOW_MS = 2 * 60 * 60 * 1000;
const AGENT_HISTORY_SAVE_DEBOUNCE_MS = 600;
const HISTORY_COLLAPSED_LIMIT = 3;
const MAX_REFERENCE_IMAGE_BYTES = 50 * 1024 * 1024;
const MOBILE_DRAWER_MEDIA_QUERY = "(max-width: 1023px)";
const ASSET_PREVIEW_WIDTHS = [256, 512, 1024, 2048] as const;
type AssetPreviewWidth = (typeof ASSET_PREVIEW_WIDTHS)[number];
const GENERATED_ASSET_INITIAL_PREVIEW_WIDTH: AssetPreviewWidth = 2048;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp"]);
const initialCanvasPreviewWidths = new Map<string, AssetPreviewWidth>();
const assetMetadataCache = new Map<string, ImageSize>();
const assetMetadataRequests = new Map<string, Promise<ImageSize | undefined>>();
const RESOLUTION_BADGE_BASE_OFFSET = 7;
const RESOLUTION_BADGE_MIN_SCALE = 0.52;
const RESOLUTION_BADGE_SMALL_IMAGE_SIDE = 32;
const RESOLUTION_BADGE_FULL_SIZE_IMAGE_SIDE = 220;
const CANVAS_DEFAULT_SNAP_MODE = true;
const shapeUtils = [GenerationPlaceholderShapeUtil, AgentPlanNodeShapeUtil];
const tldrawOptions = {
  debouncedZoomThreshold: 80
} satisfies Partial<TldrawOptions>;
const TLDRAW_LICENSE_KEY =
  "tldraw-2026-08-08/WyJ3dGU4bldjRyIsWyIqIl0sMTYsIjIwMjYtMDgtMDgiXQ.Xt7lTydUhMnKfHfp+g8Mrs9gtJjlB8uPyYMniFEfRfruCYdYEl9J0uZl0lMAf6o7GdDB1zXOVhWLFAipssI6Cw";
const TLDRAW_USER_ID = "gpt-image-canvas-local-user";
type ProviderConfigTab = "image" | "agent";
type ProviderConfigDialogMode = "default" | "onboarding";

function tldrawLocaleForLocale(locale: Locale): NonNullable<TLUserPreferences["locale"]> {
  return locale === "zh-CN" ? "zh-cn" : "en";
}

function localeForTldrawLocale(locale: TLUserPreferences["locale"]): Locale | undefined {
  if (locale === "zh-cn") {
    return "zh-CN";
  }

  if (locale === "en") {
    return "en";
  }

  return undefined;
}

function localizeDefaultPageName(editor: Editor, locale: Locale): void {
  if (locale !== "zh-CN") {
    return;
  }

  const currentPage = editor.getCurrentPage();
  if (currentPage.name === "Page 1" || currentPage.name === "page 1") {
    editor.renamePage(currentPage.id, "页面 1");
  }
}

function isDeepSeekAgentConfigView(config: Pick<AgentLlmConfigView, "baseUrl" | "model"> | null | undefined): boolean {
  if (!config) {
    return false;
  }

  const model = config.model.trim().toLowerCase();
  const baseUrl = config.baseUrl.trim().toLowerCase();
  return model.startsWith("deepseek-") || baseUrl.includes("deepseek.");
}

function agentThinkingSummaryText(locale: Locale): string {
  return locale === "zh-CN"
    ? "正在分析任务，整理生图计划与确认节点。"
    : "Reviewing the request and shaping a generation plan with confirmation steps.";
}

function agentThinkingChipLabel(locale: Locale, thinkingType: AgentThinkingType, effort: AgentReasoningEffort): string {
  if (locale === "zh-CN") {
    return thinkingType === "disabled" ? "思考 Off" : `思考 ${effort === "max" ? "Max" : "High"}`;
  }

  return thinkingType === "disabled" ? "Thinking Off" : `Thinking ${effort === "max" ? "Max" : "High"}`;
}

function agentThinkingModeLabel(locale: Locale): string {
  return locale === "zh-CN" ? "思考模式" : "Thinking mode";
}

function agentThinkingEffortLabel(locale: Locale): string {
  return locale === "zh-CN" ? "思考强度" : "Reasoning effort";
}

function agentThinkingEnabledLabel(locale: Locale): string {
  return locale === "zh-CN" ? "开启" : "On";
}

function agentThinkingDisabledLabel(locale: Locale): string {
  return locale === "zh-CN" ? "关闭" : "Off";
}

function agentThinkingRawToggleLabel(locale: Locale, expanded: boolean): string {
  if (locale === "zh-CN") {
    return expanded ? "收起原始思考" : "查看原始思考";
  }

  return expanded ? "Hide raw reasoning" : "Show raw reasoning";
}

function agentPreviewDisclosureLabel(locale: Locale, count: number): string {
  if (locale === "zh-CN") {
    return `${count} 张缩略图`;
  }

  return `${count} ${count === 1 ? "thumbnail" : "thumbnails"}`;
}

const defaultStorageConfigForm: StorageConfigFormState = {
  enabled: false,
  provider: "cos",
  cos: {
    secretId: "",
    secretKey: "",
    bucket: "source-1253253332",
    region: "ap-nanjing",
    keyPrefix: "gpt-image-canvas/assets"
  },
  s3: {
    accessKeyId: "",
    secretAccessKey: "",
    bucket: "",
    region: "auto",
    keyPrefix: "gpt-image-canvas/assets",
    endpointMode: "r2-account",
    accountId: "",
    endpoint: "",
    forcePathStyle: false
  }
};

const canvasAssetStore: TLAssetStore = {
  async upload(_asset, file) {
    return {
      src: await blobToDataUrl(file)
    };
  },
  resolve(asset, context) {
    return resolveCanvasAssetUrl(asset, context);
  }
};

const promptStarters = [
  {
    labelKey: "promptStarterProductLabel",
    promptKey: "promptStarterProductPrompt"
  },
  {
    labelKey: "promptStarterInteriorLabel",
    promptKey: "promptStarterInteriorPrompt"
  },
  {
    labelKey: "promptStarterAvatarLabel",
    promptKey: "promptStarterAvatarPrompt"
  },
  {
    labelKey: "promptStarterCityLabel",
    promptKey: "promptStarterCityPrompt"
  }
] as const;
const DEFAULT_SIZE_PRESET_ID = "portrait-4k";
const DEFAULT_SIZE_PRESET = SIZE_PRESETS.find((preset) => preset.id === DEFAULT_SIZE_PRESET_ID) ?? SIZE_PRESETS[0];
const DEFAULT_IMAGE_QUALITY: ImageQuality = "high";
const quickSizePresetIds = new Set([
  "square-1k",
  "poster-portrait",
  "poster-landscape",
  "story-9-16",
  "video-16-9",
  "wide-2k",
  DEFAULT_SIZE_PRESET_ID
]);
const quickSizePresets = SIZE_PRESETS.filter((preset) => quickSizePresetIds.has(preset.id));
const PRIMARY_GENERATION_COUNTS: readonly GenerationCount[] = [1, 2, 4];
const EXTENDED_GENERATION_COUNTS: readonly GenerationCount[] = [8, 16];

type GalleryPageModule = { default: typeof import("../gallery/GalleryPage").GalleryPage };
let galleryPageModulePromise: Promise<GalleryPageModule> | undefined;

function loadGalleryPageModule(): Promise<GalleryPageModule> {
  galleryPageModulePromise ??= import("../gallery/GalleryPage").then((module) => ({ default: module.GalleryPage }));
  return galleryPageModulePromise;
}

const LazyGalleryPage = lazy(loadGalleryPageModule);
const LazyHomePage = lazy(() => import("../home/HomePage").then((module) => ({ default: module.HomePage })));
const LazyAgentSkillDialog = lazy(() => import("../agent/AgentSkillDialog").then((module) => ({ default: module.AgentSkillDialog })));
const LazyProviderConfigDialog = lazy(() => import("../provider-config/ProviderConfigDialog").then((module) => ({ default: module.ProviderConfigDialog })));
const LazyPromptRegionEditor = lazy(() => import("./PromptRegionEditor").then((module) => ({ default: module.PromptRegionEditor })));

function preloadGalleryPage(): void {
  void loadGalleryPageModule();
}

type PersistedSnapshot = TLEditorSnapshot | TLStoreSnapshot;
type SaveStatus = "loading" | "saved" | "pending" | "saving" | "error";
type GenerationMode = "text" | "reference";
type PanelTab = "manual" | "agent";
type PanelStatusTone = "progress" | "success" | "warning" | "error";
type PromptPreviewTab = "edit" | "final";
type RegionAnnotationMode = "none" | "auto" | "manual";
type CodexLoginStatus = "idle" | "starting" | "pending" | "authorized" | "expired" | "denied" | "error";
type AgentRunStatus = "idle" | "connecting" | "running";
type AgentChatMessageRole = "user" | "assistant" | "thinking" | "system" | "error" | "question" | "plan";
type AgentPlanAction = "execute" | "cancel" | "retry_failed";

function isCopyableAgentMessageRole(role: AgentChatMessageRole): boolean {
  return role === "user" || role === "assistant" || role === "thinking";
}

function isAgentUserInputErrorCode(code: string | undefined): boolean {
  return code === "missing_selected_canvas_reference" || code === "agent_requires_user_input";
}

interface PanelStatus {
  tone: PanelStatusTone;
  message: string;
  testId: "generation-progress" | "generation-message" | "generation-warning" | "validation-message" | "generation-error";
}

interface AgentChatAssetPreview {
  id: string;
  assetId: string;
  jobId: string;
  outputId?: string;
  planId?: string;
  shapeId?: TLShapeId;
  url: string;
}

interface AgentChatMessage {
  id: string;
  role: AgentChatMessageRole;
  content: string;
  details?: string;
  timestamp: string;
  runId?: string;
  plan?: unknown;
  previews?: AgentChatAssetPreview[];
}

const agentChatMessageRoles = new Set<AgentChatMessageRole>(["user", "assistant", "thinking", "system", "error", "question", "plan"]);

function isAgentChatMessageRole(value: unknown): value is AgentChatMessageRole {
  return typeof value === "string" && agentChatMessageRoles.has(value as AgentChatMessageRole);
}

function createAgentConversationId(): string {
  return `agent-conversation-${crypto.randomUUID()}`;
}

function agentConversationTitle(messages: AgentChatMessage[]): string | undefined {
  const firstUserMessage = messages.find((message) => message.role === "user" && message.content.trim());
  const title = firstUserMessage?.content.trim().replace(/\s+/gu, " ");
  if (!title) {
    return undefined;
  }

  return title.length > 120 ? `${title.slice(0, 119)}...` : title;
}

function conversationMessagesFromAgentChat(messages: AgentChatMessage[]): AgentConversationMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    details: message.details,
    timestamp: message.timestamp,
    runId: message.runId,
    plan: message.plan,
    previews: message.previews?.map((preview) => ({
      id: preview.id,
      assetId: preview.assetId,
      jobId: preview.jobId,
      outputId: preview.outputId,
      planId: preview.planId,
      shapeId: preview.shapeId,
      url: normalizeAssetUrl(preview.url)
    }))
  }));
}

function agentChatMessagesFromConversation(messages: AgentConversationMessage[]): AgentChatMessage[] {
  return messages.flatMap((message) => {
    if (!isAgentChatMessageRole(message.role)) {
      return [];
    }

    return [
      {
        id: message.id,
        role: message.role,
        content: message.content,
        details: message.details,
        timestamp: message.timestamp,
        runId: message.runId,
        plan: message.plan,
        previews: message.previews?.map((preview) => ({
          id: preview.id,
          assetId: preview.assetId,
          jobId: preview.jobId,
          outputId: preview.outputId,
          planId: preview.planId,
          shapeId: preview.shapeId as TLShapeId | undefined,
          url: normalizeAssetUrl(preview.url)
        }))
      }
    ];
  });
}

interface GenerationSubmitInput {
  prompt: string;
  presetId: StylePresetId;
  sizePresetId: string;
  size: {
    width: number;
    height: number;
  };
  quality: ImageQuality;
  outputFormat: OutputFormat;
  count: GenerationCount;
}

interface GenerationReferenceInput {
  referenceImages?: ReferenceImageInput[];
  referenceAssetIds?: string[];
}

interface GenerationPlaceholderPlacement {
  id: TLShapeId;
  x: number;
  y: number;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
}

interface AgentOutputPlacementLayout {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
}

interface ActiveGenerationPlaceholders {
  requestId: string;
  placements: GenerationPlaceholderPlacement[];
}

interface AgentJobPlaceholderSet {
  planId: string;
  jobId: string;
  runId?: string;
  placeholderSet: ActiveGenerationPlaceholders;
  outputSlots: Map<string, number>;
}

interface ActiveGenerationTask {
  requestId: string;
  controller: AbortController;
  placeholderSet: ActiveGenerationPlaceholders;
}

interface StorageConfigFormState {
  enabled: boolean;
  provider: CloudStorageProvider;
  cos: {
    secretId: string;
    secretKey: string;
    bucket: string;
    region: string;
    keyPrefix: string;
  };
  s3: {
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    region: string;
    keyPrefix: string;
    endpointMode: S3EndpointMode;
    accountId: string;
    endpoint: string;
    forcePathStyle: boolean;
  };
}

interface StorageSecretTouchedState {
  cos: boolean;
  s3: boolean;
}

interface ReferenceSelectionItem {
  assetId: TLAssetId | null;
  localAssetId?: string;
  name: string;
  sourceUrl: string;
  width: number;
  height: number;
}

type ReferenceSelection =
  | {
      status: "none" | "too-many" | "non-image" | "unreadable";
      hint: string;
    }
  | {
      status: "ready";
      references: ReferenceSelectionItem[];
      hint: string;
    };

interface AgentReferenceSelection {
  references: ReferenceSelectionItem[];
  selectedImageCount: number;
  totalSelectedCount: number;
  hint: string;
  warning?: string;
}

interface RegionPromptFlight {
  id: string;
  itemId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

interface RegionFocusPreview {
  id: string;
  itemId: string;
  anchor: RegionFocusAnchor;
  referenceName: string;
  cropDataUrl?: string;
  cropAspectRatio?: string;
  label: string;
  description: string;
  precision: string;
  status: "summarizing" | "ready";
  collapsed: boolean;
  dismissing: boolean;
  origin: "auto" | "hover";
}

interface RegionFocusAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface RegionFocusFrame {
  id: string;
  itemId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ManualRegionDraft {
  id: string;
  insertionIndex: number;
  reference: ReferenceSelectionItem;
  region: NormalizedImageRegion;
  x: number;
  y: number;
  label: string;
}

function missingReferenceSelection(t: Translate): ReferenceSelection {
  return {
    status: "none",
    hint: t("generationReferenceNeed", { max: MAX_REFERENCE_IMAGES })
  };
}

function emptyAgentReferenceSelection(t: Translate): AgentReferenceSelection {
  return {
    references: [],
    selectedImageCount: 0,
    totalSelectedCount: 0,
    hint: t("agentReferenceEmpty")
  };
}

const historyStatusStyles: Record<GenerationStatus, string> = {
  pending: "history-status--pending",
  running: "history-status--running",
  succeeded: "history-status--succeeded",
  partial: "history-status--partial",
  failed: "history-status--failed",
  cancelled: "history-status--cancelled"
};

function sizePresetLabel(preset: SizePreset, t: Translate): string {
  return t("sizePresetLabel", { presetId: preset.id, fallback: preset.label });
}

function sizePresetOptionLabel(preset: SizePreset, t: Translate): string {
  return `${sizePresetLabel(preset, t)} - ${preset.width} x ${preset.height}`;
}

function normalizeDimension(value: string): number {
  return Number.parseInt(value, 10);
}

function sizeValidationMessage(width: number, height: number, t: Translate, locale: Locale): string {
  const result = validateImageSize({ width, height });

  if (result.ok) {
    return "";
  }

  return imageSizeValidationMessage(result.reason, t, locale);
}

function generationValidationMessage(promptValue: string, widthValue: number, heightValue: number, t: Translate, locale: Locale): string {
  return promptValue.trim() ? sizeValidationMessage(widthValue, heightValue, t, locale) : t("promptRequired");
}

function imageSizeValidationMessage(reason: ImageSizeValidationReason | undefined, t: Translate, locale: Locale): string {
  const numberFormat = new Intl.NumberFormat(locale);

  switch (reason) {
    case "non_integer":
      return t("imageSizeNonInteger");
    case "too_small":
      return t("imageSizeTooSmall", { min: MIN_IMAGE_DIMENSION });
    case "too_large":
      return t("imageSizeTooLarge", { max: MAX_IMAGE_DIMENSION });
    case "not_multiple":
      return t("imageSizeNotMultiple", { multiple: IMAGE_SIZE_MULTIPLE });
    case "aspect_ratio":
      return t("imageSizeAspectRatio", { maxRatio: MAX_IMAGE_ASPECT_RATIO });
    case "total_pixels_too_small":
      return t("imageSizeTotalTooSmall", { minPixels: numberFormat.format(MIN_TOTAL_PIXELS) });
    case "total_pixels_too_large":
      return t("imageSizeTotalTooLarge", { maxPixels: numberFormat.format(MAX_TOTAL_PIXELS) });
    case "unsupported_preset":
      return t("imageSizeUnsupportedPreset");
    default:
      return t("imageSizeUnsupportedPreset");
  }
}

function isPersistedSnapshot(value: unknown): value is PersistedSnapshot {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGenerationResponse(value: unknown): value is GenerationResponse {
  return typeof value === "object" && value !== null && "record" in value;
}

function failedOutputMessages(record: GenerationRecord): string[] {
  const seen = new Set<string>();
  const messages: string[] = [];

  for (const output of record.outputs) {
    if (output.status !== "failed") {
      continue;
    }

    const message = output.error?.trim();
    if (!message || seen.has(message)) {
      continue;
    }

    seen.add(message);
    messages.push(message);
  }

  return messages;
}

function generationFailureMessage(record: GenerationRecord, t: Translate): string {
  const summary = record.error?.trim();
  const firstFailure = failedOutputMessages(record)[0];

  if (firstFailure) {
    return summary && summary !== firstFailure ? t("generationFailureReason", { summary, reason: firstFailure }) : firstFailure;
  }

  return summary || t("generationNoSuccessfulImage");
}

function generationWarningMessage(record: GenerationRecord, insertedCount: number, failedCount: number, cloudFailedCount: number, t: Translate): string {
  const parts = [t("generationImageInsertedPart", { count: insertedCount })];
  if (failedCount > 0) {
    parts.push(t("generationFailedCount", { count: failedCount }));
  }
  if (cloudFailedCount > 0) {
    parts.push(t("generationCloudSavedButFailed", { count: cloudFailedCount }));
  }

  const firstFailure = failedOutputMessages(record)[0];
  const message = parts.join(t("commonListSeparator"));
  return firstFailure
    ? t("generationFailureReason", { summary: `${message}${t("commonSentenceEnd")}`, reason: firstFailure })
    : `${message}${t("commonSentenceEnd")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoadingGenerationPlaceholderRecord(value: unknown): boolean {
  const props = isRecord(value) && isRecord(value.props) ? value.props : undefined;
  const requestId = typeof props?.requestId === "string" ? props.requestId : "";

  return (
    isRecord(value) &&
    value.typeName === "shape" &&
    value.type === GENERATION_PLACEHOLDER_TYPE &&
    props !== undefined &&
    props.status === "loading" &&
    (requestId.startsWith("agent-") || /^\d+$/u.test(requestId))
  );
}

function isAgentPlanNodeSnapshotRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.typeName === "shape" && value.type === AGENT_PLAN_NODE_TYPE;
}

function filterLoadingPlaceholdersFromStoreSnapshot<TSnapshot>(snapshot: TSnapshot): TSnapshot {
  if (!isRecord(snapshot) || !isRecord(snapshot.store)) {
    return snapshot;
  }

  let changed = false;
  const nextStore: Record<string, unknown> = {};
  for (const [id, record] of Object.entries(snapshot.store)) {
    if (isLoadingGenerationPlaceholderRecord(record)) {
      changed = true;
      continue;
    }

    if (isAgentPlanNodeSnapshotRecord(record)) {
      changed = true;
      continue;
    }

    nextStore[id] = record;
  }

  return changed ? ({ ...snapshot, store: nextStore } as TSnapshot) : snapshot;
}

function filterLoadingPlaceholdersFromSnapshot<TSnapshot>(snapshot: TSnapshot): TSnapshot {
  if (!isRecord(snapshot)) {
    return snapshot;
  }

  if (isRecord(snapshot.document)) {
    const document = filterLoadingPlaceholdersFromStoreSnapshot(snapshot.document);
    return document === snapshot.document ? snapshot : ({ ...snapshot, document } as TSnapshot);
  }

  return filterLoadingPlaceholdersFromStoreSnapshot(snapshot);
}

function coerceStylePresetId(value: string): StylePresetId {
  return STYLE_PRESETS.some((preset) => preset.id === value) ? (value as StylePresetId) : "none";
}

function coerceGenerationCount(value: number): GenerationCount {
  return GENERATION_COUNTS.includes(value as GenerationCount) ? (value as GenerationCount) : 1;
}

function sizePresetIdForSize(widthValue: number, heightValue: number): string {
  return (
    SIZE_PRESETS.find((preset) => preset.width === widthValue && preset.height === heightValue)?.id ?? CUSTOM_SIZE_PRESET_ID
  );
}

function firstDownloadableAsset(record: GenerationRecord): GeneratedAsset | undefined {
  return record.outputs.find((output) => output.status === "succeeded" && output.asset)?.asset;
}

function successfulOutputCount(record: GenerationRecord): number {
  return record.outputs.filter((output) => output.status === "succeeded" && output.asset).length;
}

function cloudFailureCount(record: GenerationRecord): number {
  return record.outputs.filter((output) => output.asset?.cloud?.status === "failed").length;
}

function firstCloudFailureMessage(record: GenerationRecord): string | undefined {
  return record.outputs.find((output) => output.asset?.cloud?.status === "failed")?.asset?.cloud?.lastError;
}

function generationModeToRecordMode(mode: GenerationMode): GenerationRecord["mode"] {
  return mode === "reference" ? "edit" : "generate";
}

function referenceAssetIdsForRecord(record: GenerationRecord): string[] {
  if (record.referenceAssetIds?.length) {
    return record.referenceAssetIds;
  }

  return record.referenceAssetId ? [record.referenceAssetId] : [];
}

function regionPromptReferenceKey(reference: Pick<ReferenceSelectionItem, "assetId" | "localAssetId" | "sourceUrl" | "width" | "height">): string {
  return reference.localAssetId ?? reference.assetId ?? `${reference.sourceUrl}|${Math.round(reference.width)}x${Math.round(reference.height)}`;
}

function regionPromptReferenceFromSelection(reference: ReferenceSelectionItem): RegionPromptReference {
  return {
    key: regionPromptReferenceKey(reference),
    assetId: reference.assetId,
    localAssetId: reference.localAssetId,
    name: reference.name,
    sourceUrl: reference.sourceUrl,
    width: reference.width,
    height: reference.height
  };
}

function selectionReferenceFromRegionPrompt(reference: RegionPromptReference): ReferenceSelectionItem {
  return {
    assetId: reference.assetId as TLAssetId | null,
    localAssetId: reference.localAssetId,
    name: reference.name,
    sourceUrl: reference.sourceUrl,
    width: reference.width,
    height: reference.height
  };
}

function createTemporaryGenerationRecord(input: {
  requestId: string;
  submitInput: GenerationSubmitInput;
  requestMode: GenerationMode;
  referenceAssetIds?: string[];
  referenceAssetId?: string;
}): GenerationRecord {
  const promptValue = input.submitInput.prompt.trim();
  const referenceAssetIds = input.referenceAssetIds ?? (input.referenceAssetId ? [input.referenceAssetId] : undefined);

  return {
    id: input.requestId,
    mode: generationModeToRecordMode(input.requestMode),
    prompt: promptValue,
    effectivePrompt: promptValue,
    presetId: input.submitInput.presetId,
    size: input.submitInput.size,
    quality: input.submitInput.quality,
    outputFormat: input.submitInput.outputFormat,
    count: input.submitInput.count,
    status: "running",
    referenceAssetIds,
    referenceAssetId: referenceAssetIds?.[0] ?? input.referenceAssetId,
    createdAt: new Date().toISOString(),
    outputs: []
  };
}

function promptExcerpt(promptValue: string): string {
  const compact = promptValue.replace(/\s+/gu, " ").trim();
  return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact;
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.readOnly = true;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.append(textArea);
  textArea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Copy command was not accepted.");
    }
  } finally {
    textArea.remove();
  }
}

function formatCreatedTime(value: string, formatDateTime: (value: string) => string): string {
  return formatDateTime(value);
}

function formatCodexExpiry(value: string, formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions) => string, t: Translate): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return t("timeFallback15Minutes");
  }

  return formatDateTime(value, {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function createTldrawAssetId(assetId: string): TLAssetId {
  return `asset:${assetId}` as TLAssetId;
}

function createTldrawShapeId(): TLShapeId {
  return `shape:${crypto.randomUUID()}` as TLShapeId;
}

function displaySize(size: ImageSize): { width: number; height: number } {
  const scale = Math.min(1, 340 / size.width, 300 / size.height);
  return {
    width: Math.round(size.width * scale),
    height: Math.round(size.height * scale)
  };
}

function createCenteredPlacements(editor: Editor, countValue: GenerationCount, size: ImageSize): GenerationPlaceholderPlacement[] {
  const placeholderSize = displaySize(size);
  const columns = countValue >= 8 ? 4 : countValue === 1 ? 1 : 2;
  const rows = Math.ceil(countValue / columns);
  const gap = 48;
  const cellWidth = placeholderSize.width;
  const cellHeight = placeholderSize.height;
  const gridWidth = columns * cellWidth + (columns - 1) * gap;
  const gridHeight = rows * cellHeight + (rows - 1) * gap;
  const viewport = editor.getViewportPageBounds();
  const originX = viewport.center.x - gridWidth / 2;
  const originY = viewport.center.y - gridHeight / 2;

  return Array.from({ length: countValue }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      id: createTldrawShapeId(),
      x: originX + column * (cellWidth + gap),
      y: originY + row * (cellHeight + gap),
      width: placeholderSize.width,
      height: placeholderSize.height,
      targetWidth: size.width,
      targetHeight: size.height
    };
  });
}

function createGenerationPlaceholdersFromPlacements(
  editor: Editor,
  placements: GenerationPlaceholderPlacement[],
  requestId: string,
  options: { selectPlaceholders?: boolean } = {}
): ActiveGenerationPlaceholders {
  const placeholderIds = placements.map((placement) => placement.id);

  editor.createShapes<GenerationPlaceholderShape>(
    placements.map((placement, index) => ({
      id: placement.id,
      type: GENERATION_PLACEHOLDER_TYPE,
      x: placement.x,
      y: placement.y,
      props: {
        w: placement.width,
        h: placement.height,
        targetWidth: placement.targetWidth,
        targetHeight: placement.targetHeight,
        status: "loading",
        error: "",
        requestId: String(requestId),
        outputIndex: index
      }
    }))
  );
  editor.bringToFront(placeholderIds);
  if (options.selectPlaceholders ?? true) {
    editor.select(...placeholderIds);
  }

  return {
    requestId,
    placements
  };
}

function createGenerationPlaceholders(
  editor: Editor,
  input: GenerationSubmitInput,
  requestId: string,
  options: { selectPlaceholders?: boolean } = {}
): ActiveGenerationPlaceholders {
  return createGenerationPlaceholdersFromPlacements(editor, createCenteredPlacements(editor, input.count, input.size), requestId, options);
}

function deleteAgentPlanNodes(editor: Editor): number {
  const planNodeIds = editor.getCurrentPageShapes().flatMap((shape) => (isAgentPlanNodeShape(shape) ? [shape.id] : []));
  if (planNodeIds.length > 0) {
    editor.deleteShapes(planNodeIds);
  }

  return planNodeIds.length;
}

function agentPlanOutputLayout(plan: GenerationPlan): AgentOutputPlacementLayout {
  const totalCount = Math.max(1, plan.jobs.reduce((total, job) => total + Math.max(0, job.count), 0));
  const columns = totalCount >= 8 ? 4 : totalCount === 1 ? 1 : 2;
  const rows = Math.ceil(totalCount / columns);
  const displaySizes = plan.jobs.map((job) => displaySize(job.size ?? plan.defaults.size));
  const cellWidth = Math.max(...displaySizes.map((size) => size.width), 1);
  const cellHeight = Math.max(...displaySizes.map((size) => size.height), 1);

  return {
    columns,
    rows,
    cellWidth,
    cellHeight
  };
}

function agentOutputPlacementForSize(
  editor: Editor,
  targetSize: ImageSize,
  index: number,
  layout?: AgentOutputPlacementLayout
): GenerationPlaceholderPlacement {
  const size = displaySize(targetSize);
  const gap = 28;
  const columns = layout?.columns ?? 2;
  const cellWidth = layout?.cellWidth ?? size.width;
  const cellHeight = layout?.cellHeight ?? size.height;
  const rows = layout?.rows ?? Math.max(1, Math.ceil((index + 1) / columns));
  const viewport = editor.getViewportPageBounds();
  const gridWidth = columns * cellWidth + (columns - 1) * gap;
  const gridHeight = rows * cellHeight + (rows - 1) * gap;
  const baseX = viewport.center.x - gridWidth / 2;
  const baseY = viewport.center.y - gridHeight / 2;
  const column = index % columns;
  const row = Math.floor(index / columns);

  return {
    id: createTldrawShapeId(),
    x: baseX + column * (cellWidth + gap) + (cellWidth - size.width) / 2,
    y: baseY + row * (cellHeight + gap) + (cellHeight - size.height) / 2,
    width: size.width,
    height: size.height,
    targetWidth: targetSize.width,
    targetHeight: targetSize.height
  };
}

function agentOutputPlacement(
  editor: Editor,
  _planId: string | undefined,
  asset: GeneratedAsset,
  index: number
): GenerationPlaceholderPlacement {
  return agentOutputPlacementForSize(
    editor,
    {
      width: asset.width,
      height: asset.height
    },
    index
  );
}

function isGenerationPlaceholderShape(shape: unknown): shape is GenerationPlaceholderShape {
  return isRecord(shape) && shape.type === GENERATION_PLACEHOLDER_TYPE;
}

function livePlacement(editor: Editor, placement: GenerationPlaceholderPlacement): GenerationPlaceholderPlacement {
  const shape = editor.getShape(placement.id);
  if (!isGenerationPlaceholderShape(shape)) {
    return placement;
  }

  return {
    ...placement,
    x: shape.x,
    y: shape.y,
    width: shape.props.w,
    height: shape.props.h
  };
}

function createImageAsset(asset: GeneratedAsset): TLAsset {
  initialCanvasPreviewWidths.set(asset.id, GENERATED_ASSET_INITIAL_PREVIEW_WIDTH);
  rememberAssetMetadata(asset.id, {
    width: asset.width,
    height: asset.height
  });

  return {
    id: createTldrawAssetId(asset.id),
    typeName: "asset",
    type: "image",
    props: {
      src: normalizeAssetUrl(asset.url),
      w: asset.width,
      h: asset.height,
      name: asset.fileName,
      mimeType: asset.mimeType,
      isAnimated: false
    },
    meta: {
      localAssetId: asset.id
    }
  };
}

function createImageShape(
  asset: GeneratedAsset,
  placement: GenerationPlaceholderPlacement,
  promptValue: string
): Partial<TLImageShape> & { id: TLShapeId; type: "image" } {
  const assetId = createTldrawAssetId(asset.id);

  return {
    id: createTldrawShapeId(),
    type: "image",
    x: placement.x,
    y: placement.y,
    props: {
      assetId,
      w: placement.width,
      h: placement.height,
      url: normalizeAssetUrl(asset.url),
      playing: true,
      crop: null,
      flipX: false,
      flipY: false,
      altText: promptValue
    }
  };
}

function replaceGenerationPlaceholders(editor: Editor, placeholderSet: ActiveGenerationPlaceholders, record: GenerationRecord, t: Translate): number {
  const assets: TLAsset[] = [];
  const imageShapes: Array<Partial<TLImageShape> & { id: TLShapeId; type: "image" }> = [];
  const replacedPlaceholderIds: TLShapeId[] = [];
  const failedUpdates: Array<TLShapePartial<GenerationPlaceholderShape>> = [];

  placeholderSet.placements.forEach((placement, index) => {
    const placeholderShape = editor.getShape(placement.id);
    if (!isGenerationPlaceholderShape(placeholderShape)) {
      return;
    }

    const output = record.outputs[index];
    if (output?.status === "succeeded" && output.asset) {
      const resolvedPlacement = livePlacement(editor, placement);
      assets.push(createImageAsset(output.asset));
      imageShapes.push(createImageShape(output.asset, resolvedPlacement, record.prompt));
      replacedPlaceholderIds.push(placement.id);
      return;
    }

    failedUpdates.push({
      id: placement.id,
      type: GENERATION_PLACEHOLDER_TYPE,
      props: {
        status: "failed",
        error: output?.error || record.error || t("generationErrorDefault")
      }
    });
  });

  editor.run(() => {
    if (replacedPlaceholderIds.length > 0) {
      editor.deleteShapes(replacedPlaceholderIds);
    }
    if (assets.length > 0) {
      editor.createAssets(assets);
    }
    if (imageShapes.length > 0) {
      editor.createShapes(imageShapes);
    }
    if (failedUpdates.length > 0) {
      editor.updateShapes<GenerationPlaceholderShape>(failedUpdates);
    }
  });

  if (imageShapes.length > 0) {
    editor.select(...imageShapes.map((shape) => shape.id));
  }

  return imageShapes.length;
}

function generatedAssetsForRecord(record: GenerationRecord): GeneratedAsset[] {
  return record.outputs.flatMap((output) => (output.status === "succeeded" && output.asset ? [output.asset] : []));
}

async function preloadGenerationRecordPreviews(record: GenerationRecord, signal: AbortSignal): Promise<void> {
  await Promise.all(generatedAssetsForRecord(record).map((asset) => preloadGeneratedAssetPreview(asset, signal)));
}

async function preloadGeneratedAssetPreview(asset: GeneratedAsset, signal: AbortSignal): Promise<void> {
  try {
    await preloadImageUrl(assetPreviewUrl(asset.id, GENERATED_ASSET_INITIAL_PREVIEW_WIDTH), signal);
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }
  }
}

function preloadImageUrl(url: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Image preload was aborted.", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";

    function cleanup(): void {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
    }
    function complete(): void {
      cleanup();
      resolve();
    }
    function fail(): void {
      cleanup();
      reject(new Error(`Image preload failed for ${url}`));
    }
    function abort(): void {
      cleanup();
      image.src = "";
      reject(new DOMException("Image preload was aborted.", "AbortError"));
    }

    image.onload = complete;
    image.onerror = fail;
    signal.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}

function waitForGenerationPollInterval(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Generation polling was aborted.", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, GENERATION_POLL_INTERVAL_MS);

    function cleanup(): void {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }

    function abort(): void {
      cleanup();
      reject(new DOMException("Generation polling was aborted.", "AbortError"));
    }

    signal.addEventListener("abort", abort, { once: true });
  });
}

function markGenerationPlaceholdersFailed(editor: Editor, placeholderSet: ActiveGenerationPlaceholders, error: string): void {
  const updates = placeholderSet.placements.flatMap((placement) => {
    const shape = editor.getShape(placement.id);
    if (!isGenerationPlaceholderShape(shape) || shape.props.status !== "loading") {
      return [];
    }

    return [
      {
        id: placement.id,
        type: GENERATION_PLACEHOLDER_TYPE,
        props: {
          status: "failed",
          error
        }
      } satisfies TLShapePartial<GenerationPlaceholderShape>
    ];
  });

  if (updates.length > 0) {
    editor.updateShapes<GenerationPlaceholderShape>(updates);
  }
}

function deleteLoadingGenerationPlaceholders(editor: Editor, placeholderSet: ActiveGenerationPlaceholders): void {
  const loadingPlaceholderIds = placeholderSet.placements.flatMap((placement) => {
    const shape = editor.getShape(placement.id);
    return isGenerationPlaceholderShape(shape) && shape.props.status === "loading" ? [placement.id] : [];
  });

  if (loadingPlaceholderIds.length > 0) {
    editor.deleteShapes(loadingPlaceholderIds);
  }
}

function hasLoadingGenerationPlaceholders(editor: Editor, placeholderSet: ActiveGenerationPlaceholders): boolean {
  return placeholderSet.placements.some((placement) => {
    const shape = editor.getShape(placement.id);
    return isGenerationPlaceholderShape(shape) && shape.props.status === "loading";
  });
}

function firstLiveGenerationPlaceholder(editor: Editor, placeholderSet: ActiveGenerationPlaceholders): TLShapeId | undefined {
  return placeholderSet.placements.find((placement) => isGenerationPlaceholderShape(editor.getShape(placement.id)))?.id;
}

function isActiveGenerationRecord(record: GenerationRecord): boolean {
  return record.status === "pending" || record.status === "running";
}

function isTerminalGenerationRecord(record: GenerationRecord): boolean {
  return record.status === "succeeded" || record.status === "partial" || record.status === "failed" || record.status === "cancelled";
}

function placeholderSetForGenerationRecord(editor: Editor, record: GenerationRecord): ActiveGenerationPlaceholders | undefined {
  const placements = editor
    .getCurrentPageShapes()
    .flatMap((shape) => {
      if (!isGenerationPlaceholderShape(shape) || shape.props.requestId !== record.id) {
        return [];
      }

      return [
        {
          id: shape.id,
          x: shape.x,
          y: shape.y,
          width: shape.props.w,
          height: shape.props.h,
          targetWidth: shape.props.targetWidth,
          targetHeight: shape.props.targetHeight
        } satisfies GenerationPlaceholderPlacement
      ];
    })
    .sort((left, right) => {
      const leftShape = editor.getShape(left.id);
      const rightShape = editor.getShape(right.id);
      const leftIndex = isGenerationPlaceholderShape(leftShape) ? leftShape.props.outputIndex : 0;
      const rightIndex = isGenerationPlaceholderShape(rightShape) ? rightShape.props.outputIndex : 0;
      return leftIndex - rightIndex;
    });

  return placements.length > 0
    ? {
        requestId: record.id,
        placements
      }
    : undefined;
}

function resolveReferenceSelection(editor: Editor, t: Translate): ReferenceSelection {
  const selectedShapes = editor.getSelectedShapes();

  if (selectedShapes.length === 0) {
    return missingReferenceSelection(t);
  }

  if (selectedShapes.some((shape) => shape.type !== "image")) {
    return {
      status: "non-image",
      hint: t("generationSelectionNonImage", { max: MAX_REFERENCE_IMAGES })
    };
  }

  if (selectedShapes.length > MAX_REFERENCE_IMAGES) {
    return {
      status: "too-many",
      hint: t("generationSelectionTooMany", { count: selectedShapes.length, max: MAX_REFERENCE_IMAGES })
    };
  }

  const references: Array<ReferenceSelectionItem & { sortX: number; sortY: number }> = [];
  for (const shape of selectedShapes) {
    const reference = referenceItemForImageShape(editor, shape as TLImageShape);
    if (!reference) {
      return {
        status: "unreadable",
        hint: t("generationSelectionUnreadable")
      };
    }

    const bounds = editor.getShapePageBounds(shape);
    references.push({
      ...reference,
      sortX: bounds?.x ?? 0,
      sortY: bounds?.y ?? 0
    });
  }

  const sortedReferences = references
    .sort((left, right) => (left.sortY === right.sortY ? left.sortX - right.sortX : left.sortY - right.sortY))
    .map(({ sortX: _sortX, sortY: _sortY, ...reference }) => reference);

  return {
    status: "ready",
    references: sortedReferences,
    hint:
      sortedReferences.length === 1
        ? t("generationSelectedReferenceOne")
        : t("generationSelectedReferenceMany", { count: sortedReferences.length })
  };
}

function resolveAgentReferenceSelection(editor: Editor, t: Translate): AgentReferenceSelection {
  const selectedShapes = editor.getSelectedShapes();
  const selectedImages = selectedShapes
    .flatMap((shape) => (shape.type === "image" ? [shape as TLImageShape] : []))
    .map((imageShape) => ({
      imageShape,
      bounds: editor.getShapePageBounds(imageShape)
    }))
    .sort((left, right) => {
      const leftY = left.bounds?.y ?? 0;
      const rightY = right.bounds?.y ?? 0;
      return leftY === rightY ? (left.bounds?.x ?? 0) - (right.bounds?.x ?? 0) : leftY - rightY;
    });

  if (selectedImages.length === 0) {
    return {
      ...emptyAgentReferenceSelection(t),
      totalSelectedCount: selectedShapes.length
    };
  }

  const warnings: string[] = [];
  if (selectedImages.length > MAX_AGENT_SELECTED_REFERENCES) {
    warnings.push(t("agentReferenceTooMany", { count: selectedImages.length, max: MAX_AGENT_SELECTED_REFERENCES }));
  }
  const nonImageCount = selectedShapes.length - selectedImages.length;
  if (nonImageCount > 0) {
    warnings.push(t("agentReferenceIgnoredNonImages", { count: nonImageCount }));
  }

  const references: ReferenceSelectionItem[] = [];
  let unreadableCount = 0;
  for (const { imageShape } of selectedImages.slice(0, MAX_AGENT_SELECTED_REFERENCES)) {
    const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
    const sourceUrl = getImageSourceUrl(imageShape, asset);
    if (!sourceUrl || !isReadableReferenceSource(sourceUrl, asset)) {
      unreadableCount += 1;
      continue;
    }

    references.push({
      assetId: imageShape.props.assetId,
      localAssetId: getLocalAssetId(asset, sourceUrl),
      name: getReferenceName(asset, sourceUrl),
      sourceUrl,
      width: asset?.type === "image" ? asset.props.w : imageShape.props.w,
      height: asset?.type === "image" ? asset.props.h : imageShape.props.h
    });
  }

  if (unreadableCount > 0) {
    warnings.push(t("agentReferenceUnreadableSkipped", { count: unreadableCount }));
  }

  return {
    references,
    selectedImageCount: selectedImages.length,
    totalSelectedCount: selectedShapes.length,
    hint:
      references.length > 0
        ? t("agentReferenceReady", { count: references.length, max: MAX_AGENT_SELECTED_REFERENCES })
        : t("agentReferenceEmpty"),
    warning: warnings.join(t("commonListSeparator")) || undefined
  };
}

function areReferenceSelectionsEqual(left: ReferenceSelection, right: ReferenceSelection): boolean {
  if (left.status !== right.status) {
    return false;
  }

  if (left.status !== "ready" || right.status !== "ready") {
    return left.hint === right.hint;
  }

  return (
    left.hint === right.hint &&
    left.references.length === right.references.length &&
    left.references.every((leftReference, index) => {
      const rightReference = right.references[index];
      return (
        rightReference !== undefined &&
        leftReference.assetId === rightReference.assetId &&
        leftReference.localAssetId === rightReference.localAssetId &&
        leftReference.name === rightReference.name &&
        leftReference.sourceUrl === rightReference.sourceUrl &&
        leftReference.width === rightReference.width &&
        leftReference.height === rightReference.height
      );
    })
  );
}

function areAgentReferenceSelectionsEqual(left: AgentReferenceSelection, right: AgentReferenceSelection): boolean {
  return (
    left.hint === right.hint &&
    left.warning === right.warning &&
    left.selectedImageCount === right.selectedImageCount &&
    left.totalSelectedCount === right.totalSelectedCount &&
    left.references.length === right.references.length &&
    left.references.every((leftReference, index) => {
      const rightReference = right.references[index];
      return (
        rightReference !== undefined &&
        leftReference.assetId === rightReference.assetId &&
        leftReference.localAssetId === rightReference.localAssetId &&
        leftReference.name === rightReference.name &&
        leftReference.sourceUrl === rightReference.sourceUrl &&
        leftReference.width === rightReference.width &&
        leftReference.height === rightReference.height
      );
    })
  );
}

function getImageSourceUrl(shape: TLImageShape, asset: TLAsset | undefined): string | undefined {
  const assetSrc = asset?.type === "image" && typeof asset.props.src === "string" ? asset.props.src : undefined;
  return assetSrc || shape.props.url || undefined;
}

function getAssetMimeType(asset: TLAsset | undefined): string | undefined {
  return asset?.type === "image" && typeof asset.props.mimeType === "string" ? asset.props.mimeType : undefined;
}

function isReadableReferenceSource(sourceUrl: string, asset: TLAsset | undefined): boolean {
  const assetMimeType = getAssetMimeType(asset);
  if (assetMimeType && !isSupportedReferenceImageType(assetMimeType)) {
    return false;
  }

  if (sourceUrl.startsWith("data:")) {
    const mimeType = /^data:([^;,]+)/iu.exec(sourceUrl)?.[1];
    return Boolean(mimeType && isSupportedReferenceImageType(mimeType));
  }

  if (sourceUrl.startsWith("blob:")) {
    return true;
  }

  try {
    return new URL(sourceUrl, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
}

function getReferenceName(asset: TLAsset | undefined, sourceUrl: string): string {
  if (asset?.type === "image" && asset.props.name) {
    return asset.props.name;
  }

  try {
    const pathname = new URL(sourceUrl, window.location.origin).pathname;
    return pathname.split("/").filter(Boolean).at(-1) || "reference-image";
  } catch {
    return "reference-image";
  }
}

function getLocalAssetId(asset: TLAsset | undefined, sourceUrl?: string): string | undefined {
  const localAssetId = asset?.meta && typeof asset.meta.localAssetId === "string" ? asset.meta.localAssetId : undefined;
  if (localAssetId) {
    return localAssetId;
  }

  if (!sourceUrl) {
    return undefined;
  }

  try {
    const url = new URL(sourceUrl, window.location.origin);
    if (url.origin === window.location.origin) {
      const match = /^\/api\/assets\/([^/?#]+)(?:\/(?:download|preview))?$/u.exec(url.pathname);
      return match?.[1];
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function resolveCanvasAssetUrl(asset: TLAsset, context: TLAssetContext): string | null {
  if (asset.type !== "image") {
    return "src" in asset.props && typeof asset.props.src === "string" ? asset.props.src : null;
  }

  const sourceUrl = asset.props.src;
  if (!sourceUrl || context.shouldResolveToOriginal) {
    return sourceUrl || null;
  }

  const localAssetId = getLocalAssetId(asset, sourceUrl);
  if (!localAssetId) {
    return sourceUrl;
  }

  const previewWidth = Math.max(
    previewWidthForAssetContext(asset, context),
    initialCanvasPreviewWidths.get(localAssetId) ?? ASSET_PREVIEW_WIDTHS[0]
  );
  return assetPreviewUrl(localAssetId, previewWidth);
}

function previewWidthForAssetContext(asset: Extract<TLAsset, { type: "image" }>, context: TLAssetContext): AssetPreviewWidth {
  const dpr = Number.isFinite(context.dpr) && context.dpr > 0 ? context.dpr : window.devicePixelRatio || 1;
  const requestedWidth = Math.max(1, Math.ceil(asset.props.w * context.screenScale * dpr));
  return ASSET_PREVIEW_WIDTHS.find((widthValue) => widthValue >= requestedWidth) ?? ASSET_PREVIEW_WIDTHS[ASSET_PREVIEW_WIDTHS.length - 1];
}

interface CanvasResolutionBadgeTarget {
  localAssetId?: string;
  fallbackSize: ImageSize;
  badgeScale: number;
  screenX: number;
  screenY: number;
}

interface ClientPoint {
  x: number;
  y: number;
}

function CanvasResolutionBadgeOverlay() {
  const editor = useEditor();
  const pointerClientPoint = usePointerClientPoint(editor);
  const target = useValue("canvas resolution badge target", () => getCanvasResolutionBadgeTarget(editor, pointerClientPoint), [
    editor,
    pointerClientPoint?.x,
    pointerClientPoint?.y
  ]);
  const [loadedMetadata, setLoadedMetadata] = useState<{ assetId: string; size: ImageSize } | undefined>();

  const localAssetId = target?.localAssetId;
  const cachedMetadata = localAssetId ? assetMetadataCache.get(localAssetId) : undefined;
  const loadedSize = loadedMetadata && loadedMetadata.assetId === localAssetId ? loadedMetadata.size : undefined;
  const resolvedSize = localAssetId ? (cachedMetadata ?? loadedSize) : target?.fallbackSize;

  useEffect(() => {
    if (!localAssetId || assetMetadataCache.has(localAssetId)) {
      return;
    }

    let isActive = true;
    void fetchAssetMetadata(localAssetId).then((size) => {
      if (isActive && size) {
        setLoadedMetadata({ assetId: localAssetId, size });
      }
    });

    return () => {
      isActive = false;
    };
  }, [localAssetId]);

  if (!target || !resolvedSize) {
    return null;
  }

  const tier: ResolutionTier = resolutionTierForSize(resolvedSize);

  return (
    <span
      aria-hidden="true"
      className="canvas-resolution-badge"
      data-resolution-tier={tier}
      data-testid="canvas-resolution-badge"
      style={{
        transform: `translate3d(${Math.round(target.screenX + resolutionBadgeOffset(target.badgeScale))}px, ${Math.round(
          target.screenY + resolutionBadgeOffset(target.badgeScale)
        )}px, 0) scale(${target.badgeScale})`
      }}
    >
      {tier}
    </span>
  );
}

function CanvasSnapIndicator({ className, ...props }: TLSnapIndicatorProps) {
  const snapIndicatorClassName = className ? `canvas-snap-indicator ${className}` : "canvas-snap-indicator";
  return <DefaultSnapIndicator {...props} className={snapIndicatorClassName} />;
}

function usePointerClientPoint(editor: Editor): ClientPoint | undefined {
  const [point, setPoint] = useState<ClientPoint | undefined>();
  const frameRef = useRef<number | undefined>();
  const latestPointRef = useRef<ClientPoint | undefined>();

  useEffect(() => {
    const ownerWindow = editor.getContainer().ownerDocument.defaultView ?? window;

    const updatePoint = (nextPoint: ClientPoint | undefined) => {
      latestPointRef.current = nextPoint;
      if (frameRef.current !== undefined) {
        return;
      }

      frameRef.current = ownerWindow.requestAnimationFrame(() => {
        frameRef.current = undefined;
        setPoint(latestPointRef.current);
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      updatePoint({
        x: event.clientX,
        y: event.clientY
      });
    };
    const handlePointerLeave = () => updatePoint(undefined);

    ownerWindow.addEventListener("pointermove", handlePointerMove, { passive: true });
    ownerWindow.addEventListener("pointerleave", handlePointerLeave);
    ownerWindow.addEventListener("blur", handlePointerLeave);

    return () => {
      ownerWindow.removeEventListener("pointermove", handlePointerMove);
      ownerWindow.removeEventListener("pointerleave", handlePointerLeave);
      ownerWindow.removeEventListener("blur", handlePointerLeave);
      if (frameRef.current !== undefined) {
        ownerWindow.cancelAnimationFrame(frameRef.current);
      }
    };
  }, [editor]);

  return point;
}

function getCanvasResolutionBadgeTarget(editor: Editor, pointerClientPoint: ClientPoint | undefined): CanvasResolutionBadgeTarget | undefined {
  const imageShape = getImageShapeUnderPointer(editor, pointerClientPoint);
  if (!imageShape) {
    return undefined;
  }

  const bounds = editor.getShapePageBounds(imageShape);
  if (!bounds) {
    return undefined;
  }

  const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
  const sourceUrl = getImageSourceUrl(imageShape, asset);
  const localAssetId = getLocalAssetId(asset, sourceUrl);
  const topLeft = editor.pageToScreen({ x: bounds.x, y: bounds.y });
  const bottomRight = editor.pageToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h });
  const containerRect = editor.getContainer().getBoundingClientRect();
  const screenWidth = Math.abs(bottomRight.x - topLeft.x);
  const screenHeight = Math.abs(bottomRight.y - topLeft.y);

  return {
    localAssetId,
    fallbackSize: fallbackImageSize(imageShape, asset),
    badgeScale: resolutionBadgeScale(screenWidth, screenHeight, containerRect.width),
    screenX: topLeft.x - containerRect.left,
    screenY: topLeft.y - containerRect.top
  };
}

function resolutionBadgeScale(screenWidth: number, screenHeight: number, canvasWidth: number): number {
  const imageShortSide = Math.max(0, Math.min(screenWidth, screenHeight));
  const imageScale =
    imageShortSide >= RESOLUTION_BADGE_FULL_SIZE_IMAGE_SIDE
      ? 1
      : RESOLUTION_BADGE_MIN_SCALE +
        ((Math.max(imageShortSide, RESOLUTION_BADGE_SMALL_IMAGE_SIDE) - RESOLUTION_BADGE_SMALL_IMAGE_SIDE) /
          (RESOLUTION_BADGE_FULL_SIZE_IMAGE_SIDE - RESOLUTION_BADGE_SMALL_IMAGE_SIDE)) *
          (1 - RESOLUTION_BADGE_MIN_SCALE);
  const canvasScale = canvasWidth < 520 ? 0.78 : canvasWidth < 760 ? 0.88 : 1;

  return Math.max(RESOLUTION_BADGE_MIN_SCALE, Math.min(1, imageScale, canvasScale));
}

function resolutionBadgeOffset(scale: number): number {
  return Math.max(4, RESOLUTION_BADGE_BASE_OFFSET * scale);
}

function getImageShapeUnderPointer(editor: Editor, pointerClientPoint: ClientPoint | undefined): TLImageShape | undefined {
  if (!pointerClientPoint || !isPointerOverCanvas(editor, pointerClientPoint)) {
    return undefined;
  }

  const shapeAtPoint = editor.getShapeAtPoint(editor.screenToPage(pointerClientPoint), {
    hitInside: true,
    renderingOnly: true,
    filter: (shape) => shape.type === "image"
  });

  return shapeAtPoint?.type === "image" ? (shapeAtPoint as TLImageShape) : undefined;
}

function referenceItemForImageShape(editor: Editor, imageShape: TLImageShape): ReferenceSelectionItem | undefined {
  const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
  const sourceUrl = getImageSourceUrl(imageShape, asset);
  if (!sourceUrl || !isReadableReferenceSource(sourceUrl, asset)) {
    return undefined;
  }

  return {
    assetId: imageShape.props.assetId,
    localAssetId: getLocalAssetId(asset, sourceUrl),
    name: getReferenceName(asset, sourceUrl),
    sourceUrl,
    width: asset?.type === "image" ? asset.props.w : imageShape.props.w,
    height: asset?.type === "image" ? asset.props.h : imageShape.props.h
  };
}

function normalizedImagePointFromCanvasPointer(editor: Editor, imageShape: TLImageShape, pointerClientPoint: ClientPoint): { x: number; y: number } {
  const bounds = editor.getShapePageBounds(imageShape);
  const pagePoint = editor.screenToPage(pointerClientPoint);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    return { x: 0.5, y: 0.5 };
  }

  return {
    x: Math.max(0, Math.min(1, (pagePoint.x - bounds.x) / bounds.w)),
    y: Math.max(0, Math.min(1, (pagePoint.y - bounds.y) / bounds.h))
  };
}

function regionFocusRectFromImageShape(
  editor: Editor,
  imageShape: TLImageShape,
  region: NormalizedImageRegion,
  pointerClientPoint: ClientPoint
): Pick<RegionFocusFrame, "x" | "y" | "width" | "height"> {
  const bounds = editor.getShapePageBounds(imageShape);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    return {
      x: pointerClientPoint.x - 24,
      y: pointerClientPoint.y - 24,
      width: 48,
      height: 48
    };
  }

  const topLeft = editor.pageToScreen({
    x: bounds.x + bounds.w * region.x,
    y: bounds.y + bounds.h * region.y
  });
  const bottomRight = editor.pageToScreen({
    x: bounds.x + bounds.w * (region.x + region.width),
    y: bounds.y + bounds.h * (region.y + region.height)
  });
  const x = Math.min(topLeft.x, bottomRight.x);
  const y = Math.min(topLeft.y, bottomRight.y);
  return {
    x,
    y,
    width: Math.max(28, Math.abs(bottomRight.x - topLeft.x)),
    height: Math.max(28, Math.abs(bottomRight.y - topLeft.y))
  };
}

function isPointerOverCanvas(editor: Editor, pointerClientPoint: ClientPoint): boolean {
  const target = editor.getContainer().ownerDocument.elementFromPoint(pointerClientPoint.x, pointerClientPoint.y);
  return Boolean(target?.closest(".tl-canvas"));
}

function fallbackImageSize(imageShape: TLImageShape, asset: TLAsset | undefined): ImageSize {
  if (asset?.type === "image" && isUsableImageSize(asset.props)) {
    return {
      width: asset.props.w,
      height: asset.props.h
    };
  }

  return {
    width: imageShape.props.w,
    height: imageShape.props.h
  };
}

function isUsableImageSize(size: { width?: unknown; height?: unknown; w?: unknown; h?: unknown }): boolean {
  const width = typeof size.width === "number" ? size.width : size.w;
  const height = typeof size.height === "number" ? size.height : size.h;
  return typeof width === "number" && typeof height === "number" && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function rememberAssetMetadata(assetId: string, size: ImageSize): void {
  if (isUsableImageSize(size)) {
    assetMetadataCache.set(assetId, size);
  }
}

async function fetchAssetMetadata(assetId: string): Promise<ImageSize | undefined> {
  const cached = assetMetadataCache.get(assetId);
  if (cached) {
    return cached;
  }

  const existingRequest = assetMetadataRequests.get(assetId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = apiFetch(`/api/assets/${encodeURIComponent(assetId)}/metadata`)
    .then(async (response) => {
      if (!response.ok) {
        return undefined;
      }

      const body = (await response.json()) as AssetMetadataResponse;
      const size = {
        width: body.width,
        height: body.height
      };

      if (body.id !== assetId || !isUsableImageSize(size)) {
        return undefined;
      }

      rememberAssetMetadata(assetId, size);
      return size;
    })
    .catch(() => undefined)
    .finally(() => {
      assetMetadataRequests.delete(assetId);
    });

  assetMetadataRequests.set(assetId, request);
  return request;
}

function findCanvasImageShape(editor: Editor, record: GenerationRecord): TLShapeId | undefined {
  const assetIds = new Set(
    record.outputs.flatMap((output) => (output.status === "succeeded" && output.asset ? [output.asset.id] : []))
  );
  if (assetIds.size === 0) {
    return undefined;
  }

  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== "image") {
      continue;
    }

    const imageShape = shape as TLImageShape;
    const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
    const sourceUrl = getImageSourceUrl(imageShape, asset);
    const localAssetId = getLocalAssetId(asset, sourceUrl);

    if (localAssetId && assetIds.has(localAssetId)) {
      return imageShape.id;
    }
  }

  return undefined;
}

function findCanvasImageShapeByAssetId(editor: Editor, assetId: string, shapeId?: TLShapeId): TLShapeId | undefined {
  if (shapeId && editor.getShape(shapeId)?.type === "image") {
    return shapeId;
  }

  for (const shape of editor.getCurrentPageShapes()) {
    if (shape.type !== "image") {
      continue;
    }

    const imageShape = shape as TLImageShape;
    const asset = imageShape.props.assetId ? editor.getAsset(imageShape.props.assetId) : undefined;
    const sourceUrl = getImageSourceUrl(imageShape, asset);
    const localAssetId = getLocalAssetId(asset, sourceUrl);
    if (localAssetId === assetId || imageShape.props.assetId === assetId || asset?.id === assetId) {
      return imageShape.id;
    }
  }

  return undefined;
}

function fileNameWithImageExtension(name: string, mimeType: string): string {
  if (/\.(png|jpe?g|webp|gif)$/iu.test(name)) {
    return name;
  }

  const extension = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  return `${name}.${extension}`;
}

function isSupportedReferenceImageType(mimeType: string): boolean {
  return SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType.toLowerCase());
}

async function blobToDataUrl(blob: Blob, t?: Translate): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t ? t("readReferenceDataFailed") : "Unable to read reference image data."));
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error(t ? t("readReferenceDataFailed") : "Unable to read reference image data."));
    };
    reader.readAsDataURL(blob);
  });
}

async function readReferenceImage(selection: ReferenceSelectionItem, signal: AbortSignal, t: Translate): Promise<{
  dataUrl: string;
  fileName: string;
  mimeType: string;
}> {
  let response: Response;

  try {
    response = await apiFetch(selection.sourceUrl, { signal });
  } catch {
    throw new Error(t("readReferenceFailed"));
  }

  if (!response.ok) {
    throw new Error(t("readReferenceMissingFile"));
  }

  const blob = await response.blob();
  if (!isSupportedReferenceImageType(blob.type)) {
    throw new Error(t("referenceInvalidType"));
  }
  if (blob.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error(t("referenceFileTooLarge"));
  }

  return {
    dataUrl: await blobToDataUrl(blob, t),
    fileName: fileNameWithImageExtension(selection.name, blob.type),
    mimeType: blob.type
  };
}

async function cropReferenceRegion(
  reference: ReferenceSelectionItem,
  region: NormalizedImageRegion,
  signal: AbortSignal,
  t: Translate
): Promise<{ dataUrl: string; fileName: string; aspectRatio: string }> {
  const source = await readReferenceImage(reference, signal, t);
  const image = await loadImageElement(source.dataUrl, t);
  const bounds = regionPixelBounds(region, { width: image.naturalWidth, height: image.naturalHeight });

  const canvas = document.createElement("canvas");
  canvas.width = bounds.width;
  canvas.height = bounds.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error(t("readReferenceDataFailed"));
  }

  context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  const croppedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((nextBlob) => {
      if (nextBlob) {
        resolve(nextBlob);
        return;
      }

      reject(new Error(t("readReferenceDataFailed")));
    }, "image/png");
  });

  return {
    aspectRatio: `${bounds.width} / ${bounds.height}`,
    dataUrl: await blobToDataUrl(croppedBlob, t),
    fileName: fileNameWithImageExtension(`region-${reference.name}`, "image/png")
  };
}

function loadImageElement(dataUrl: string, t: Translate): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t("readReferenceDataFailed")));
    image.src = dataUrl;
  });
}

function regionSummaryStatusCopy(state: RegionSummaryAvailability, t: Translate, error = ""): string {
  if (error) {
    return error;
  }
  if (state.status === "ready") {
    return t(state.source === "summary" ? "regionPromptUsingSummaryLlm" : "regionPromptUsingAgentFallback");
  }
  if (state.status === "loading") {
    return t("regionPromptConfigLoading");
  }
  if (state.status === "summary-no-vision") {
    return t("regionPromptSummaryNoVision");
  }
  return t("regionPromptMissingConfig");
}

function activeReferenceSelection(input: {
  isRegionAnnotationActive: boolean;
  referenceSelection: ReferenceSelection;
  regionPromptReferences: ReferenceSelectionItem[];
}): ReferenceSelectionItem[] {
  if (input.isRegionAnnotationActive) {
    return input.regionPromptReferences;
  }

  return input.referenceSelection.status === "ready" ? input.referenceSelection.references : [];
}

function referenceValidationCopy(input: {
  hasPendingRegionPrompt: boolean;
  isReferenceMode: boolean;
  isReferenceReady: boolean;
  isRegionAnnotationActive: boolean;
  referenceSelection: ReferenceSelection;
  t: Translate;
}): string {
  if (!input.isReferenceMode) {
    return "";
  }
  if (input.isRegionAnnotationActive && input.hasPendingRegionPrompt) {
    return input.t("regionPromptSummaryPending");
  }
  if (input.isReferenceReady) {
    return "";
  }
  return input.isRegionAnnotationActive ? input.t("regionPromptDependencyNeed") : input.referenceSelection.hint;
}

function referenceStateTitleCopy(input: {
  activeReferenceCount: number;
  isReferenceReady: boolean;
  isRegionAnnotationActive: boolean;
  t: Translate;
}): string {
  if (input.isReferenceReady) {
    return input.isRegionAnnotationActive
      ? input.t("regionPromptDependencyReady", { count: input.activeReferenceCount })
      : input.t("generationReferenceReady", { count: input.activeReferenceCount });
  }

  return input.isRegionAnnotationActive
    ? input.t("regionPromptDependencyNeed")
    : input.t("generationReferenceNeed", { max: MAX_REFERENCE_IMAGES });
}

function regionAnnotationModeHintCopy(mode: RegionAnnotationMode, t: Translate): string {
  if (mode === "auto") {
    return t("regionPromptAutoModeHint");
  }
  if (mode === "manual") {
    return t("regionPromptManualModeHint");
  }
  return t("regionPromptNoneModeHint");
}

function regionAnnotationStatusCopy(input: {
  agentConfigError: string;
  mode: RegionAnnotationMode;
  regionSummaryState: RegionSummaryAvailability;
  summaryConfigError: string;
  t: Translate;
}): string {
  if (input.mode === "auto") {
    return regionSummaryStatusCopy(input.regionSummaryState, input.t, input.summaryConfigError || input.agentConfigError);
  }
  if (input.mode === "manual") {
    return input.t("regionPromptManualStatus");
  }
  return input.t("regionPromptNoneStatus");
}

function regionPromptFlightStyle(flight: RegionPromptFlight): CSSProperties {
  return {
    left: `${flight.fromX}px`,
    top: `${flight.fromY}px`,
    "--region-flight-x": `${flight.toX - flight.fromX}px`,
    "--region-flight-y": `${flight.toY - flight.fromY}px`
  } as CSSProperties;
}

function regionFocusAnchorFromRect(rect: DOMRect): RegionFocusAnchor {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height
  };
}

function regionFocusFrameStyle(frame: RegionFocusFrame): CSSProperties {
  return {
    left: `${frame.x}px`,
    top: `${frame.y}px`,
    width: `${frame.width}px`,
    height: `${frame.height}px`
  };
}

function regionFocusPreviewStyle(preview: RegionFocusPreview, stackIndex = 0): CSSProperties {
  const width = preview.collapsed ? 190 : 258;
  const estimatedHeight = preview.collapsed ? 44 : 360;
  const gap = 10;
  const viewportWidth = typeof window === "undefined" ? preview.anchor.right + width + gap : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? preview.anchor.bottom + estimatedHeight + gap : window.innerHeight;
  const anchorCenter = preview.anchor.left + preview.anchor.width / 2;
  const fitsAbove = preview.anchor.top >= estimatedHeight + gap + 12;
  const stackGap = preview.collapsed ? Math.min(3, stackIndex) * 38 : 0;
  const belowTop = Math.min(preview.anchor.bottom + gap + stackGap, viewportHeight - estimatedHeight - 12);
  const aboveTop = Math.max(12, preview.anchor.top - gap - stackGap);
  const stackLeftNudge = preview.collapsed ? Math.min(3, stackIndex) * -8 : 0;
  return {
    "--region-crop-aspect-ratio": preview.cropAspectRatio ?? "1 / 1",
    "--region-card-y": fitsAbove ? "translateY(-100%)" : "translateY(0)",
    zIndex: preview.collapsed ? 72 + Math.max(0, 4 - stackIndex) : 78,
    left: `${Math.max(12, Math.min(anchorCenter - width / 2 + stackLeftNudge, viewportWidth - width - 12))}px`,
    top: `${fitsAbove ? aboveTop : Math.max(12, belowTop)}px`,
    transform: fitsAbove ? "translateY(-100%)" : undefined
  } as CSSProperties;
}

function manualRegionDraftStyle(draft: ManualRegionDraft): CSSProperties {
  const width = 280;
  const height = 116;
  const viewportWidth = typeof window === "undefined" ? draft.x + width : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? draft.y + height : window.innerHeight;
  return {
    left: `${Math.max(12, Math.min(draft.x + 14, viewportWidth - width - 12))}px`,
    top: `${Math.max(12, Math.min(draft.y + 14, viewportHeight - height - 12))}px`
  };
}

function agentWebSocketUrl(connectionId?: string | null, runId?: string | null, conversationId?: string | null): string {
  const url = new URL("/api/agent/ws", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (connectionId) {
    url.searchParams.set("connectionId", connectionId);
  }
  if (runId) {
    url.searchParams.set("runId", runId);
  }
  if (conversationId) {
    url.searchParams.set("conversationId", conversationId);
  }
  return appendHostTokenParam(url).toString();
}

function agentReferenceAssetId(reference: ReferenceSelectionItem, index: number): string {
  return reference.localAssetId ?? reference.assetId ?? `selected-canvas-image-${index + 1}`;
}

function agentReferenceLabel(reference: ReferenceSelectionItem, index: number, t: Translate): string {
  const name = reference.name.trim();
  if (name && name !== "reference-image") {
    return name;
  }

  return t("agentReferenceFallbackLabel", { index: index + 1 });
}

async function buildAgentSelectedReferences(input: {
  references: ReferenceSelectionItem[];
  t: Translate;
}): Promise<AgentSelectedCanvasReference[]> {
  const controller = new AbortController();
  return Promise.all(
    input.references.slice(0, MAX_AGENT_SELECTED_REFERENCES).map(async (reference, index) => {
      const readableReference = await readReferenceImage(reference, controller.signal, input.t);
      const selectedReference: AgentSelectedCanvasReference = {
        id: `selected-${index + 1}`,
        assetId: agentReferenceAssetId(reference, index),
        label: agentReferenceLabel(reference, index, input.t),
        width: Math.round(reference.width),
        height: Math.round(reference.height),
        mimeType: readableReference.mimeType,
        dataUrl: readableReference.dataUrl
      };

      return selectedReference;
    })
  );
}

function parseAgentServerEvent(data: MessageEvent["data"]): AgentServerEvent | undefined {
  if (typeof data !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(data) as unknown;
    return isRecord(parsed) && typeof parsed.type === "string" ? (parsed as unknown as AgentServerEvent) : undefined;
  } catch {
    return undefined;
  }
}

function optionalShapeIdFromEvent(event: AgentServerEvent): TLShapeId | undefined {
  return isRecord(event) && typeof event.shapeId === "string" ? (event.shapeId as TLShapeId) : undefined;
}

function planJobDependencies(plan: GenerationPlan, job: GenerationJob): string[] {
  return plan.edges.filter((edge) => edge.toJobId === job.id).map((edge) => edge.fromJobId);
}

function planReferenceLabel(reference: GenerationReference, t: Translate): string {
  const usage = t("agentPlanReferenceUsageLabel", { usage: reference.usage });
  if (reference.kind === "generated_output") {
    return `${usage}: ${t("agentPlanReferenceGenerated", { jobId: reference.jobId ?? "?" })}`;
  }

  return `${usage}: ${t("agentPlanReferenceSelected", { label: reference.label ?? reference.assetId ?? "?" })}`;
}

function planReferenceCount(plan: GenerationPlan): number {
  return plan.jobs.reduce((count, job) => count + job.references.length, 0);
}

function AgentPlanReviewNodes({ plan, t }: { plan: GenerationPlan; t: Translate }) {
  const summary = summarizeGenerationPlanOutputs(plan);
  const nodes = [
    t("agentPlanReviewScope", { total: summary.totalImageCount, jobs: summary.jobCount }),
    t("agentPlanReviewReferences", { count: planReferenceCount(plan) }),
    t("agentPlanReviewDependencies", { count: plan.edges.length }),
    t("agentPlanReviewConfirm")
  ];

  return (
    <section className="agent-plan-card__review" aria-label={t("agentPlanReviewTitle")}>
      <span className="agent-plan-card__section-title">{t("agentPlanReviewTitle")}</span>
      <div className="agent-plan-card__review-nodes">
        {nodes.map((node, index) => (
          <span className="agent-plan-card__review-node" data-step={index + 1} key={`${index}-${node}`}>
            {node}
          </span>
        ))}
      </div>
    </section>
  );
}

function AgentPlanJobDetails({ plan, t }: { plan: GenerationPlan; t: Translate }) {
  return (
    <section className="agent-plan-card__details" aria-label={t("agentPlanDetailsTitle")}>
      <span className="agent-plan-card__section-title">{t("agentPlanDetailsTitle")}</span>
      <div className="agent-plan-card__job-list">
        {plan.jobs.map((job) => {
          const dependencies = planJobDependencies(plan, job);
          const references = job.references.map((reference) => planReferenceLabel(reference, t));
          return (
            <article className="agent-plan-card__job" data-status={job.status} key={job.id}>
              <span className="agent-plan-card__job-title">
                {t("agentPlanJobLine", {
                  id: job.id,
                  role: t("agentPlanRoleLabel", { role: job.role }),
                  count: job.count,
                  status: t("agentPlanJobStatusLabel", { status: job.status })
                })}
              </span>
              <p>
                <strong>{t("agentPlanJobPrompt")}</strong>
                {job.prompt}
              </p>
              {dependencies.length > 0 ? <span>{t("agentPlanJobDependsOn", { ids: dependencies.join(", ") })}</span> : null}
              <span>
                {references.length > 0
                  ? t("agentPlanJobReferences", { references: references.join(", ") })
                  : t("agentPlanJobNoReferences")}
              </span>
              {job.error ? <span>{job.error}</span> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AgentPlanCard({
  isAgentConfigured,
  isAgentRunning,
  onAction,
  plan,
  readOnly = false,
  t
}: {
  isAgentConfigured: boolean;
  isAgentRunning: boolean;
  onAction: (plan: GenerationPlan, action: AgentPlanAction) => void;
  plan: unknown;
  readOnly?: boolean;
  t: Translate;
}) {
  if (!isGenerationPlan(plan)) {
    return (
      <div className="agent-plan-card agent-plan-card--invalid" data-state="invalid" data-testid="agent-plan-card" role="status">
        <strong>{t("agentPlanUnreadableTitle")}</strong>
        <span>{t("agentPlanUnreadableCard")}</span>
      </div>
    );
  }

  const summary = summarizeGenerationPlanOutputs(plan);
  const canExecute = (plan.status === "awaiting_confirmation" || plan.status === "confirmed") && isAgentConfigured && !isAgentRunning;
  const showConfirmationHint = plan.status === "awaiting_confirmation" || plan.status === "confirmed";
  const showRetry = hasFailedPlanJob(plan);
  const canRetry = showRetry && isAgentConfigured && !isAgentRunning;
  const showCancel = plan.status === "running";
  const canCancel = showCancel && isAgentRunning;

  return (
    <article
      className="agent-plan-card"
      data-testid="agent-plan-card"
    >
      <span className="agent-plan-card__heading">
        <strong>{plan.title}</strong>
        <span className="agent-plan-card__status">{t("agentPlanStatus", { status: plan.status })}</span>
      </span>
      <span className="agent-plan-card__summary">
        {t("agentPlanSummary", {
          finalOutputs: summary.finalImageCount,
          jobs: summary.jobCount,
          supportOutputs: summary.supportImageCount
        })}
      </span>
      {showConfirmationHint ? <span className="agent-plan-card__hint">{t("agentPlanConfirmationHint")}</span> : null}
      <AgentPlanReviewNodes plan={plan} t={t} />
      <AgentPlanJobDetails plan={plan} t={t} />
      {readOnly ? null : <div className="agent-plan-card__actions">
        <button
          className="agent-plan-card__action agent-plan-card__action--primary"
          disabled={!canExecute}
          type="button"
          onClick={() => onAction(plan, "execute")}
        >
          <CheckCircle2 className="size-3.5" aria-hidden="true" />
          {t("agentPlanExecute")}
        </button>
        {showRetry ? (
          <button
            className="agent-plan-card__action"
            disabled={!canRetry}
            type="button"
            onClick={() => onAction(plan, "retry_failed")}
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {t("agentPlanRetryFailed")}
          </button>
        ) : null}
        {showCancel ? (
          <button
            className="agent-plan-card__action"
            disabled={!canCancel}
            type="button"
            onClick={() => onAction(plan, "cancel")}
          >
            <CircleStop className="size-3.5" aria-hidden="true" />
            {t("agentPlanCancel")}
          </button>
        ) : null}
      </div>}
    </article>
  );
}

function AgentHistoryDialog({
  conversation,
  error,
  formatDateTime,
  isDetailLoading,
  isLoading,
  isRestoringDisabled,
  onClose,
  onRestore,
  onSelectConversation,
  selectedConversationId,
  summaries,
  t
}: {
  conversation: AgentConversation | null;
  error: string;
  formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  isDetailLoading: boolean;
  isLoading: boolean;
  isRestoringDisabled: boolean;
  onClose: () => void;
  onRestore: (conversation: AgentConversation) => void;
  onSelectConversation: (conversationId: string) => void;
  selectedConversationId: string | null;
  summaries: AgentConversationSummary[];
  t: Translate;
}) {
  return (
    <div className="agent-history-backdrop app-modal-backdrop" data-testid="agent-history-dialog" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="agent-history-title"
        aria-modal="true"
        className="agent-history-dialog app-modal-surface"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="agent-history-dialog__header">
          <div className="agent-history-dialog__title">
            <span className="agent-history-dialog__mark" aria-hidden="true">
              <History className="size-4" />
            </span>
            <div>
              <h2 id="agent-history-title">{t("agentHistoryTitle")}</h2>
              <p>{t("agentHistorySubtitle")}</p>
            </div>
          </div>
          <button aria-label={t("commonClose")} className="history-icon-action" type="button" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        {error ? (
          <p className="agent-history-dialog__alert" role="alert">
            {error}
          </p>
        ) : null}

        <div className="agent-history-dialog__body">
          <aside className="agent-history-list" aria-label={t("agentHistoryListLabel")}>
            {isLoading ? (
              <div className="agent-history-empty" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>{t("agentHistoryLoading")}</span>
              </div>
            ) : summaries.length === 0 ? (
              <div className="agent-history-empty">
                <MessageCirclePlus className="size-5" aria-hidden="true" />
                <strong>{t("agentHistoryEmptyTitle")}</strong>
                <span>{t("agentHistoryEmptyCopy")}</span>
              </div>
            ) : (
              summaries.map((summary) => (
                <button
                  aria-pressed={summary.id === selectedConversationId}
                  className="agent-history-list__item"
                  data-selected={summary.id === selectedConversationId}
                  key={summary.id}
                  type="button"
                  onClick={() => onSelectConversation(summary.id)}
                >
                  <span className="agent-history-list__item-title">{summary.title}</span>
                  <span className="agent-history-list__item-preview">{summary.lastMessagePreview ?? t("agentHistoryNoPreview")}</span>
                  <span className="agent-history-list__item-meta">
                    {t("agentHistoryMessageCount", { count: summary.messageCount })}
                    <time dateTime={summary.updatedAt}>{formatDateTime(summary.updatedAt, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
                  </span>
                </button>
              ))
            )}
          </aside>

          <section className="agent-history-detail" aria-label={t("agentHistoryDetailLabel")}>
            {isDetailLoading ? (
              <div className="agent-history-empty" role="status">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <span>{t("agentHistoryDetailLoading")}</span>
              </div>
            ) : conversation ? (
              <>
                <div className="agent-history-detail__head">
                  <div>
                    <h3>{conversation.title}</h3>
                    <p>
                      <time dateTime={conversation.updatedAt}>
                        {formatDateTime(conversation.updatedAt, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </time>
                      <span>{t("agentHistoryMessageCount", { count: conversation.messages.length })}</span>
                    </p>
                  </div>
                  <button
                    className="agent-history-restore"
                    disabled={isRestoringDisabled}
                    type="button"
                    onClick={() => onRestore(conversation)}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {t("agentHistoryRestore")}
                  </button>
                </div>
                <div className="agent-history-transcript">
                  {conversation.messages.map((message) => (
                    <AgentHistoryMessage
                      formatDateTime={formatDateTime}
                      key={message.id}
                      message={message}
                      t={t}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="agent-history-empty">
                <History className="size-5" aria-hidden="true" />
                <strong>{t("agentHistorySelectTitle")}</strong>
                <span>{t("agentHistorySelectCopy")}</span>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function AgentHistoryMessage({
  formatDateTime,
  message,
  t
}: {
  formatDateTime: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  message: AgentConversationMessage;
  t: Translate;
}) {
  const previewCount = message.previews?.length ?? 0;

  return (
    <article className={`agent-message agent-message--${message.role}`} data-message-role={message.role}>
      <div className={message.role === "system" || message.role === "error" ? "agent-status-line__meta" : "agent-message__meta"}>
        <span>{t("agentMessageRole", { role: message.role })}</span>
        <time dateTime={message.timestamp}>{formatDateTime(message.timestamp, { hour: "2-digit", minute: "2-digit" })}</time>
      </div>
      <p className="agent-message__content">{message.content}</p>
      {message.role === "thinking" && message.details ? (
        <details className="agent-thinking-details">
          <summary className="agent-thinking-details__toggle">{t("agentHistoryThinkingDetails")}</summary>
          <pre className="agent-thinking-details__content">{message.details}</pre>
        </details>
      ) : null}
      {message.plan ? (
        <AgentPlanCard
          isAgentConfigured={false}
          isAgentRunning={false}
          plan={message.plan}
          readOnly
          t={t}
          onAction={() => undefined}
        />
      ) : null}
      {previewCount > 0 && message.previews ? (
        <div className="agent-preview-list">
          {message.previews.map((preview) => (
            <figure className="agent-history-preview" key={preview.id}>
              <img alt="" src={preview.url} />
              <figcaption>{preview.jobId}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
    </article>
  );
}

async function readErrorMessage(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText: t("errorFallback", { status: response.status }),
      locale,
      status: response.status
    });
  } catch {
    return t("errorFallback", { status: response.status });
  }
}

function storageConfigToForm(config: StorageConfigResponse | null): StorageConfigFormState {
  if (!config) {
    return cloneDefaultStorageConfigForm();
  }

  return {
    enabled: config.enabled,
    provider: config.provider,
    cos: {
      secretId: config.cos.secretId,
      secretKey: config.cos.secretKey.value ?? "",
      bucket: config.cos.bucket,
      region: config.cos.region,
      keyPrefix: config.cos.keyPrefix
    },
    s3: {
      accessKeyId: config.s3.accessKeyId,
      secretAccessKey: config.s3.secretAccessKey.value ?? "",
      bucket: config.s3.bucket,
      region: config.s3.region,
      keyPrefix: config.s3.keyPrefix,
      endpointMode: config.s3.endpointMode,
      accountId: config.s3.accountId,
      endpoint: config.s3.endpoint,
      forcePathStyle: config.s3.forcePathStyle
    }
  };
}

function storageConfigRequestBody(
  form: StorageConfigFormState,
  options: { preserveSecret: boolean; forceEnabled?: boolean }
): SaveStorageConfigRequest {
  const enabled = options.forceEnabled ?? form.enabled;
  if (form.provider === "s3") {
    return {
      enabled,
      provider: "s3",
      s3: {
        accessKeyId: form.s3.accessKeyId.trim(),
        secretAccessKey: options.preserveSecret ? undefined : form.s3.secretAccessKey,
        preserveSecret: options.preserveSecret,
        bucket: form.s3.bucket.trim(),
        region: form.s3.region.trim(),
        keyPrefix: form.s3.keyPrefix.trim(),
        endpointMode: form.s3.endpointMode,
        accountId: form.s3.accountId.trim(),
        endpoint: form.s3.endpoint.trim(),
        forcePathStyle: form.s3.forcePathStyle
      }
    };
  }

  return {
    enabled,
    provider: "cos",
    cos: {
      secretId: form.cos.secretId.trim(),
      secretKey: options.preserveSecret ? undefined : form.cos.secretKey,
      preserveSecret: options.preserveSecret,
      bucket: form.cos.bucket.trim(),
      region: form.cos.region.trim(),
      keyPrefix: form.cos.keyPrefix.trim()
    }
  };
}

function cloneDefaultStorageConfigForm(): StorageConfigFormState {
  return {
    ...defaultStorageConfigForm,
    cos: { ...defaultStorageConfigForm.cos },
    s3: { ...defaultStorageConfigForm.s3 }
  };
}

function shouldPreserveStorageSecret(
  form: StorageConfigFormState,
  config: StorageConfigResponse | null,
  touched: StorageSecretTouchedState
): boolean {
  return form.provider === "s3"
    ? !touched.s3 && Boolean(config?.s3.secretAccessKey.hasSecret)
    : !touched.cos && Boolean(config?.cos.secretKey.hasSecret);
}

function requestGenerationNotificationPermission(): void {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "default") {
    return;
  }

  void Notification.requestPermission().catch(() => undefined);
}

function showGenerationCompleteNotification(record: GenerationRecord, insertedCount: number, failedCount: number, t: Translate): void {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const isPartial = record.status === "partial" || failedCount > 0;
  const body = isPartial ? t("generationInsertedPartialBody", { inserted: insertedCount, failed: failedCount }) : t("generationImageInserted", { count: insertedCount });

  new Notification(isPartial ? t("generationNotificationPartialTitle") : t("generationNotificationTitle"), {
    body,
    icon: "/favicon.png",
    tag: `generation-${record.id}`
  });
}

function saveStatusLabel(status: SaveStatus, t: Translate): string {
  switch (status) {
    case "loading":
      return t("saveStatusLoading");
    case "pending":
      return t("saveStatusPending");
    case "saving":
      return t("saveStatusSaving");
    case "error":
      return t("saveStatusError");
    case "saved":
    default:
      return t("saveStatusSaved");
  }
}

function SaveStatusIcon({ status }: { status: SaveStatus }) {
  if (status === "saving" || status === "loading") {
    return <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />;
  }

  if (status === "error") {
    return <AlertTriangle className="size-3.5" aria-hidden="true" />;
  }

  if (status === "saved") {
    return <CheckCircle2 className="size-3.5" aria-hidden="true" />;
  }

  return <Cloud className="size-3.5" aria-hidden="true" />;
}

function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`} aria-hidden="true">
      <img className="brand-mark__image" src="/brand-logo.png" alt="" draggable={false} />
    </span>
  );
}

function BrandName() {
  return (
    <p className="brand-name" title="AI-Cove-Design">
      <span className="brand-name__prefix">AI</span>
      <span className="brand-name__dash">-</span>
      <span className="brand-name__image">Cove</span>
      <span className="brand-name__dash">-</span>
      <span className="brand-name__canvas">Design</span>
    </p>
  );
}

function TopNavigation({
  isAiCoveMode,
  onOpenProviderConfig,
  route,
  onNavigate,
  onPreloadGallery
}: {
  isAiCoveMode: boolean;
  onOpenProviderConfig: () => void;
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onPreloadGallery: () => void;
}) {
  const { t } = useI18n();

  return (
    <header className="top-navigation">
      <div className="top-navigation__inner">
        <div className="brand-lockup min-w-0">
          <BrandMark />
          <div className="min-w-0">
            <BrandName />
            <p className="brand-tagline">{t("appTagline")}</p>
          </div>
        </div>
        <div className="top-navigation__actions">
          <nav aria-label={t("navMainAria")} className="top-navigation__links">
            {isAiCoveMode ? null : (
              <a
                aria-current={route === "home" ? "page" : undefined}
                className="top-navigation__link"
                data-active={route === "home"}
                data-testid="nav-home"
                href="/"
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate("home");
                }}
              >
                <Sparkles className="size-4" aria-hidden="true" />
                {t("navHome")}
              </a>
            )}
            <a
              aria-current={route === "canvas" ? "page" : undefined}
              className="top-navigation__link"
              data-active={route === "canvas"}
              data-testid="nav-canvas"
              href="/canvas"
              onClick={(event) => {
                event.preventDefault();
                onNavigate("canvas");
              }}
            >
              <Square className="size-4" aria-hidden="true" />
              {t("navCanvas")}
            </a>
            <a
              aria-current={route === "gallery" ? "page" : undefined}
              className="top-navigation__link"
              data-active={route === "gallery"}
              data-testid="nav-gallery"
              href="/gallery"
              onFocus={onPreloadGallery}
              onMouseEnter={onPreloadGallery}
              onClick={(event) => {
                event.preventDefault();
                onNavigate("gallery");
              }}
            >
              <ImageIcon className="size-4" aria-hidden="true" />
              {t("navGallery")}
            </a>
          </nav>
          <button
            aria-label={t("navOpenProviderConfig")}
            className="top-navigation__settings"
            data-testid="global-provider-settings"
            title={t("navProviderConfig")}
            type="button"
            onClick={onOpenProviderConfig}
          >
            <Settings className="size-4" aria-hidden="true" />
            <span>{t("navSettings")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function CanvasThemeSync({ onChange }: { onChange: (isDarkMode: boolean) => void }) {
  const isDarkMode = useIsDarkMode();

  useEffect(() => {
    onChange(isDarkMode);
  }, [isDarkMode, onChange]);

  return null;
}

function providerStatusDetails(authStatus: AuthStatusResponse | null, isAuthLoading: boolean, t: Translate): {
  copy: string;
  provider: "openai" | "codex" | "loading" | "none";
  title: string;
} {
  if (authStatus?.provider === "openai") {
    if (authStatus.activeSource?.id === "local-openai") {
      return {
        copy: t("providerStatusLocalCopy"),
        provider: "openai",
        title: t("providerStatusLocalTitle")
      };
    }

    if (authStatus.activeSource?.id === "env-openai") {
      return {
        copy: t("providerStatusEnvCopy"),
        provider: "openai",
        title: t("providerStatusEnvTitle")
      };
    }

    return {
      copy: t("providerStatusGenericOpenAICopy"),
      provider: "openai",
      title: "OpenAI API"
    };
  }

  if (authStatus?.provider === "codex") {
    return {
      copy: authStatus.codex.email ?? authStatus.codex.accountId ?? t("providerStatusCodexCopy"),
      provider: "codex",
      title: t("providerStatusCodexTitle")
    };
  }

  if (isAuthLoading) {
    return {
      copy: t("providerStatusLoadingCopy"),
      provider: "loading",
      title: t("providerStatusLoadingTitle")
    };
  }

  return {
    copy: t("providerStatusNoneCopy"),
    provider: "none",
    title: t("providerStatusNoneTitle")
  };
}

function ProviderStatusPopover({
  authError,
  authStatus,
  codexLoginStatus,
  isAuthLoading,
  onLogoutCodex,
  onStartCodexLogin
}: {
  authError: string;
  authStatus: AuthStatusResponse | null;
  codexLoginStatus: CodexLoginStatus;
  isAuthLoading: boolean;
  onLogoutCodex: () => void;
  onStartCodexLogin: () => void;
}) {
  const { t } = useI18n();
  const details = providerStatusDetails(authStatus, isAuthLoading, t);
  const isCodexStarting = codexLoginStatus === "starting";

  return (
    <div className="provider-status-popover" data-provider={details.provider} data-testid="auth-provider-card">
      <button
        aria-label={t("providerStatusAria", { title: details.title })}
        className="provider-status-popover__trigger"
        type="button"
      >
        {details.provider === "openai" || details.provider === "codex" ? (
          <ShieldCheck className="size-4" aria-hidden="true" />
        ) : details.provider === "loading" ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <KeyRound className="size-4" aria-hidden="true" />
        )}
      </button>

      <div className="provider-status-popover__content">
        <span className="control-label">{t("providerStatusImageService")}</span>
        <p className="provider-status-popover__title">{details.title}</p>
        <p className="provider-status-popover__copy">{details.copy}</p>

        {authError ? (
          <p className="provider-status-popover__error" role="alert">
            {authError}
          </p>
        ) : null}

        {details.provider === "codex" ? (
          <button
            className="provider-status-popover__action"
            type="button"
            title={t("providerLogoutCodex")}
            data-testid="codex-logout-button"
            disabled={isAuthLoading}
            onClick={onLogoutCodex}
          >
            <LogOut className="size-4" aria-hidden="true" />
            {t("providerLogoutCodex")}
          </button>
        ) : details.provider === "openai" ? null : (
          <button
            className="provider-status-popover__action"
            type="button"
            data-testid="codex-login-button"
            disabled={isAuthLoading || isCodexStarting}
            onClick={onStartCodexLogin}
          >
            {isCodexStarting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="size-4" aria-hidden="true" />
            )}
            {t("providerLoginCodex")}
          </button>
        )}
      </div>
    </div>
  );
}

export function App() {
  const { formatDateTime, locale, setLocale, t } = useI18n();
  const tldrawLocale = tldrawLocaleForLocale(locale);
  const [tldrawUserPreferences, setTldrawUserPreferences] = useState<TLUserPreferences>(() => ({
    id: TLDRAW_USER_ID,
    isSnapMode: CANVAS_DEFAULT_SNAP_MODE,
    locale: tldrawLocale
  }));
  useEffect(() => {
    setTldrawUserPreferences((currentPreferences) =>
      currentPreferences.locale === tldrawLocale ? currentPreferences : { ...currentPreferences, locale: tldrawLocale }
    );
  }, [tldrawLocale]);
  const syncTldrawUserPreferences = useCallback(
    (preferences: TLUserPreferences) => {
      setTldrawUserPreferences({
        ...preferences,
        id: TLDRAW_USER_ID,
        isSnapMode: preferences.isSnapMode ?? CANVAS_DEFAULT_SNAP_MODE,
        locale: preferences.locale ?? tldrawLocale
      });

      const nextLocale = localeForTldrawLocale(preferences.locale);
      if (nextLocale && nextLocale !== locale) {
        setLocale(nextLocale);
      }
    },
    [locale, setLocale, tldrawLocale]
  );
  const tldrawUser = useTldrawUser({
    userPreferences: tldrawUserPreferences,
    setUserPreferences: syncTldrawUserPreferences
  });
  const [isAiCoveMode, setIsAiCoveMode] = useState(() => isAiCoveEmbeddedRuntime());
  const [route, setRoute] = useState<AppRoute>(() => initialRouteForCurrentRuntime());
  const shouldAutoOpenCanvasRef = useRef(route !== "gallery");
  const providerOnboardingDismissedRef = useRef(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("manual");
  const [generationMode, setGenerationMode] = useState<GenerationMode>("text");
  const [prompt, setPrompt] = useState("");
  const [stylePreset, setStylePreset] = useState<StylePresetId>("none");
  const [sizePresetId, setSizePresetId] = useState(DEFAULT_SIZE_PRESET.id);
  const [width, setWidth] = useState(DEFAULT_SIZE_PRESET.width);
  const [height, setHeight] = useState(DEFAULT_SIZE_PRESET.height);
  const [count, setCount] = useState<GenerationCount>(1);
  const [quality, setQuality] = useState<ImageQuality>(DEFAULT_IMAGE_QUALITY);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("png");
  const [activeGenerationCount, setActiveGenerationCount] = useState(0);
  const [isProjectLoaded, setIsProjectLoaded] = useState(false);
  const [projectSnapshot, setProjectSnapshot] = useState<PersistedSnapshot | undefined>();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [saveError, setSaveError] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [generationMessage, setGenerationMessage] = useState("");
  const [generationWarning, setGenerationWarning] = useState("");
  const [generationHistory, setGenerationHistory] = useState<GenerationRecord[]>([]);
  const generationHistoryRef = useRef<GenerationRecord[]>([]);
  generationHistoryRef.current = generationHistory;
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const [isMobileDrawer, setIsMobileDrawer] = useState(false);
  const [isAiPanelOpen, setIsAiPanelOpen] = useState(false);
  const [isStorageDialogOpen, setIsStorageDialogOpen] = useState(false);
  const [isProviderConfigDialogOpen, setIsProviderConfigDialogOpen] = useState(false);
  const [providerConfigInitialTab, setProviderConfigInitialTab] = useState<ProviderConfigTab>("image");
  const [providerConfigDialogMode, setProviderConfigDialogMode] = useState<ProviderConfigDialogMode>("default");
  const [isAgentSkillDialogOpen, setIsAgentSkillDialogOpen] = useState(false);
  const [storageConfig, setStorageConfig] = useState<StorageConfigResponse | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [isCodexLoginOpen, setIsCodexLoginOpen] = useState(false);
  const [codexDevice, setCodexDevice] = useState<CodexDeviceStartResponse | null>(null);
  const [codexLoginStatus, setCodexLoginStatus] = useState<CodexLoginStatus>("idle");
  const [codexLoginMessage, setCodexLoginMessage] = useState("");
  const [storageForm, setStorageForm] = useState<StorageConfigFormState>(() => cloneDefaultStorageConfigForm());
  const [storageSecretTouched, setStorageSecretTouched] = useState<StorageSecretTouchedState>({ cos: false, s3: false });
  const [storageError, setStorageError] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [isStorageSaving, setIsStorageSaving] = useState(false);
  const [isStorageTesting, setIsStorageTesting] = useState(false);
  const [referenceSelection, setReferenceSelection] = useState<ReferenceSelection>(() => missingReferenceSelection(t));
  const [regionAnnotationMode, setRegionAnnotationMode] = useState<RegionAnnotationMode>("none");
  const [promptPreviewTab, setPromptPreviewTab] = useState<PromptPreviewTab>("edit");
  const [isRegionModifierPressed, setIsRegionModifierPressed] = useState(false);
  const [regionPromptItems, setRegionPromptItems] = useState<RegionPromptItem[]>([]);
  const [arrivingRegionPromptIds, setArrivingRegionPromptIds] = useState<Set<string>>(() => new Set());
  const [regionPromptFlights, setRegionPromptFlights] = useState<RegionPromptFlight[]>([]);
  const [regionFocusFrames, setRegionFocusFrames] = useState<RegionFocusFrame[]>([]);
  const [regionFocusPreviews, setRegionFocusPreviews] = useState<RegionFocusPreview[]>([]);
  const [manualRegionDraft, setManualRegionDraft] = useState<ManualRegionDraft | null>(null);
  const [agentSizePresetId, setAgentSizePresetId] = useState(DEFAULT_SIZE_PRESET.id);
  const [agentWidth, setAgentWidth] = useState(DEFAULT_SIZE_PRESET.width);
  const [agentHeight, setAgentHeight] = useState(DEFAULT_SIZE_PRESET.height);
  const [agentQuality, setAgentQuality] = useState<ImageQuality>(DEFAULT_IMAGE_QUALITY);
  const [agentOutputFormat, setAgentOutputFormat] = useState<OutputFormat>("png");
  const [agentInput, setAgentInput] = useState("");
  const [agentConfig, setAgentConfig] = useState<AgentLlmConfigView | null>(null);
  const [isAgentConfigLoading, setIsAgentConfigLoading] = useState(true);
  const [agentConfigError, setAgentConfigError] = useState("");
  const [summaryConfig, setSummaryConfig] = useState<SummaryLlmConfigView | null>(null);
  const [isSummaryConfigLoading, setIsSummaryConfigLoading] = useState(true);
  const [summaryConfigError, setSummaryConfigError] = useState("");
  const [isHostSessionChecked, setIsHostSessionChecked] = useState(false);
  const [hostSessionError, setHostSessionError] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentChatMessage[]>([]);
  const [currentAgentConversationId, setCurrentAgentConversationId] = useState<string | null>(null);
  const [isAgentHistoryOpen, setIsAgentHistoryOpen] = useState(false);
  const [agentHistorySummaries, setAgentHistorySummaries] = useState<AgentConversationSummary[]>([]);
  const [selectedAgentHistoryId, setSelectedAgentHistoryId] = useState<string | null>(null);
  const [selectedAgentConversation, setSelectedAgentConversation] = useState<AgentConversation | null>(null);
  const [isAgentHistoryLoading, setIsAgentHistoryLoading] = useState(false);
  const [isAgentHistoryDetailLoading, setIsAgentHistoryDetailLoading] = useState(false);
  const [agentHistoryError, setAgentHistoryError] = useState("");
  const [copiedAgentMessageId, setCopiedAgentMessageId] = useState<string | null>(null);
  const [expandedThinkingMessageIds, setExpandedThinkingMessageIds] = useState<string[]>([]);
  const [agentRunStatus, setAgentRunStatus] = useState<AgentRunStatus>("idle");
  const [agentReferenceSelection, setAgentReferenceSelection] = useState<AgentReferenceSelection>(() => emptyAgentReferenceSelection(t));
  const [agentThinkingType, setAgentThinkingType] = useState<AgentThinkingType>("enabled");
  const [agentReasoningEffort, setAgentReasoningEffort] = useState<AgentReasoningEffort>("high");
  const [isAgentSettingsOpen, setIsAgentSettingsOpen] = useState(false);
  const [isCanvasDarkMode, setIsCanvasDarkMode] = useState(false);
  const canvasShellRef = useRef<HTMLElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const promptRegionEditorRef = useRef<PromptRegionEditorHandle | null>(null);
  const pendingPromptRegionFocusRef = useRef<number | null>(null);
  const promptEditorCursorIndexRef = useRef(0);
  const regionPromptItemsRef = useRef<RegionPromptItem[]>([]);
  regionPromptItemsRef.current = regionPromptItems;
  const manualRegionInputRef = useRef<HTMLInputElement | null>(null);
  const panelCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const regionCanvasPointerDownRef = useRef<((event: PointerEvent) => void) | null>(null);
  const activeGenerationsRef = useRef<Map<string, ActiveGenerationTask>>(new Map());
  const regionFocusFrameTimersRef = useRef<Map<string, number>>(new Map());
  const regionFocusPreviewTimersRef = useRef<Map<string, number>>(new Map());
  const agentRequestRef = useRef(0);
  const agentSocketRef = useRef<WebSocket | null>(null);
  const agentSocketOpenPromiseRef = useRef<Promise<WebSocket> | null>(null);
  const agentSocketPingTimerRef = useRef<number | undefined>();
  const agentSocketReconnectTimerRef = useRef<number | undefined>();
  const agentSocketReconnectDeadlineRef = useRef<number | undefined>();
  const agentSocketReconnectDelayRef = useRef(AGENT_SOCKET_RECONNECT_INITIAL_MS);
  const agentConnectionIdRef = useRef<string | null>(null);
  const activeAgentRunIdRef = useRef<string | null>(null);
  const currentAgentConversationIdRef = useRef<string | null>(null);
  currentAgentConversationIdRef.current = currentAgentConversationId;
  const agentHistorySaveTimerRef = useRef<number | undefined>();
  const agentHistorySaveRequestRef = useRef(0);
  const agentTranscriptRef = useRef<HTMLElement | null>(null);
  const agentOutputPlacementCountsRef = useRef<Map<string, number>>(new Map());
  const agentJobPlaceholdersRef = useRef<Map<string, AgentJobPlaceholderSet>>(new Map());
  const pendingAgentSelectedReferencesRef = useRef<Map<string, AgentSelectedCanvasReference[]>>(new Map());
  const agentPlanSelectedReferencesRef = useRef<Map<string, AgentSelectedCanvasReference[]>>(new Map());
  const agentPlaceholderRequestRef = useRef(0);
  const agentCopyResetTimerRef = useRef<number | undefined>();
  const agentPlanCreatedRunIdsRef = useRef<Set<string>>(new Set());
  const agentUserInputRunIdsRef = useRef<Set<string>>(new Set());
  const saveTimerRef = useRef<number | undefined>();
  const codexPollTimerRef = useRef<number | undefined>();
  const saveRequestRef = useRef(0);
  const isGenerating = activeGenerationCount > 0;
  const hasGenerationProvider = authStatus?.provider === "openai" || authStatus?.provider === "codex";
  const generationSubmitAction = generationSubmitActionForProviderState({
    authProvider: authStatus?.provider ?? null,
    isAuthLoading
  });
  const isAgentRunning = agentRunStatus === "connecting" || agentRunStatus === "running";
  const agentRunStatusLabel = t("agentRunStatus", { status: agentRunStatus });
  const agentCancelRunLabel = `${agentRunStatusLabel}: ${t("agentCancelRun")}`;
  const trimmedAgentInput = agentInput.trim();
  const isAgentConfigured = Boolean(agentConfig?.configured);
  const supportsAgentThinkingControls = isDeepSeekAgentConfigView(agentConfig);
  const agentDefaultsValidationMessage = sizeValidationMessage(agentWidth, agentHeight, t, locale);
  const canSendAgentMessage = Boolean(
    trimmedAgentInput && isAgentConfigured && !isAgentConfigLoading && !isAgentRunning && !agentDefaultsValidationMessage
  );
  const agentPlannerOptions = useMemo<AgentPlannerOptions>(
    () => ({
      thinking: {
        type: agentThinkingType
      },
      reasoningEffort: agentThinkingType === "enabled" ? agentReasoningEffort : undefined
    }),
    [agentReasoningEffort, agentThinkingType]
  );
  const agentDefaults = useMemo(
    () => ({
      size: {
        width: agentWidth,
        height: agentHeight
      },
      quality: agentQuality,
      outputFormat: agentOutputFormat
    }),
    [agentHeight, agentOutputFormat, agentQuality, agentWidth]
  );
  const agentSizeSummary = `${agentWidth} x ${agentHeight}`;
  const agentCompactSizeSummary = `${agentWidth}x${agentHeight}`;
  const agentQualitySummary = t("qualityLabel", { quality: agentQuality });
  const agentFormatSummary = t("outputFormatLabel", { format: agentOutputFormat });
  const agentThinkingSummary = agentThinkingChipLabel(locale, agentThinkingType, agentReasoningEffort);
  const agentReferenceCount = agentReferenceSelection.references.length;
  const agentReferenceSummary = t("agentParamReferences", {
    count: agentReferenceCount,
    max: MAX_AGENT_SELECTED_REFERENCES
  });
  const agentReferenceCompactSummary = `${agentReferenceCount}/${MAX_AGENT_SELECTED_REFERENCES}`;
  const agentSizePresetButtons = useMemo<SizePreset[]>(() => {
    const selectedPreset = SIZE_PRESETS.find((item) => item.id === agentSizePresetId);
    if (selectedPreset && !quickSizePresetIds.has(selectedPreset.id)) {
      return [...quickSizePresets, selectedPreset];
    }

    return quickSizePresets;
  }, [agentSizePresetId]);

  const trimmedPrompt = prompt.trim();
  const dimensionValidationMessage = sizeValidationMessage(width, height, t, locale);
  const isReferenceMode = generationMode === "reference";
  const isRegionAnnotationActive = isReferenceMode && regionAnnotationMode !== "none";
  const regionPromptReferences = useMemo(
    () => referencesForRegionPromptItems(regionPromptItems).map(selectionReferenceFromRegionPrompt),
    [regionPromptItems]
  );
  const hasPendingRegionPrompt = regionPromptItems.some((item) => item.status === "summarizing");
  const activeReferenceItems = activeReferenceSelection({
    isRegionAnnotationActive,
    referenceSelection,
    regionPromptReferences
  });
  const submittedPromptPreview = isRegionAnnotationActive ? promptWithRegionTokens(prompt, regionPromptItems) : prompt;
  const promptValidationMessage = submittedPromptPreview.trim() ? "" : t("promptRequired");
  const isReferenceReady = isReferenceMode && activeReferenceItems.length > 0;
  const regionSummaryState = regionSummaryAvailability({
    agentConfig,
    isAgentConfigLoading,
    isSummaryConfigLoading,
    summaryConfig
  });
  const canUseRegionSummary = regionSummaryState.status === "ready";
  const referenceValidationMessage = referenceValidationCopy({
    hasPendingRegionPrompt,
    isReferenceMode,
    isReferenceReady,
    isRegionAnnotationActive,
    referenceSelection,
    t
  });
  const referenceStateTitle = referenceStateTitleCopy({
    activeReferenceCount: activeReferenceItems.length,
    isReferenceReady,
    isRegionAnnotationActive,
    t
  });
  const referenceStateHint = isRegionAnnotationActive ? t("regionPromptCanvasHint") : referenceSelection.hint;
  const regionAnnotationModeHint = regionAnnotationModeHintCopy(regionAnnotationMode, t);
  const regionAnnotationStatus = regionAnnotationStatusCopy({
    agentConfigError,
    mode: regionAnnotationMode,
    regionSummaryState,
    summaryConfigError,
    t
  });
  const finalPromptPreview = isRegionAnnotationActive ? finalRegionPromptForModel(prompt, regionPromptItems, locale) : "";
  const finalPromptPreviewTitle = finalPromptPreview.trim() || t("promptFinalPreviewEmpty");
  const isPromptEditorEmpty = !prompt.trim() && regionPromptItems.length === 0;
  const validationMessage = promptValidationMessage || dimensionValidationMessage || referenceValidationMessage;
  const shouldShowValidation = generationSubmitAction === "generate" && Boolean(validationMessage);
  const canGenerate = generationSubmitAction === "configure-image-model" || !validationMessage;
  const isHostSessionBlocked = Boolean(hostSessionError);
  const tldrawComponents = useMemo(
    () =>
      ({
        InFrontOfTheCanvas: () => (
          <>
            <CanvasThemeSync onChange={setIsCanvasDarkMode} />
            <CanvasResolutionBadgeOverlay />
          </>
        ),
        SnapIndicator: CanvasSnapIndicator,
        StylePanel: null
      }) satisfies TLComponents,
    []
  );

  const navigateToRoute = useCallback((nextRoute: AppRoute, options: { replace?: boolean } = {}): void => {
    if (!options.replace) {
      shouldAutoOpenCanvasRef.current = false;
    }

    const nextPath = pathForRoute(nextRoute);
    if (window.location.pathname !== nextPath) {
      if (options.replace) {
        window.history.replaceState(null, "", nextPath);
      } else {
        window.history.pushState(null, "", nextPath);
      }
    }
    setRoute(nextRoute);
  }, []);

  const visibleHistory = useMemo(
    () => (isHistoryExpanded ? generationHistory : generationHistory.slice(0, HISTORY_COLLAPSED_LIMIT)),
    [generationHistory, isHistoryExpanded]
  );
  const hiddenHistoryCount = Math.max(0, generationHistory.length - HISTORY_COLLAPSED_LIMIT);
  const hasAdditionalHistory = hiddenHistoryCount > 0;
  const isExtendedCountSelected = EXTENDED_GENERATION_COUNTS.includes(count);
  const loadAgentConfig = useCallback(async (signal?: AbortSignal): Promise<AgentLlmConfigView | null> => {
    setIsAgentConfigLoading(true);
    setAgentConfigError("");

    try {
      const response = await apiFetch("/api/agent-config", { signal });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const config = (await response.json()) as AgentLlmConfigView;
      if (!signal?.aborted) {
        setAgentConfig(config);
      }
      return config;
    } catch (error) {
      if (!signal?.aborted) {
        setAgentConfigError(error instanceof Error ? error.message : t("agentConfigLoadFailed"));
      }
      return null;
    } finally {
      if (!signal?.aborted) {
        setIsAgentConfigLoading(false);
      }
    }
  }, [locale, t]);
  const loadSummaryConfig = useCallback(async (signal?: AbortSignal): Promise<SummaryLlmConfigView | null> => {
    setIsSummaryConfigLoading(true);
    setSummaryConfigError("");

    try {
      const response = await apiFetch("/api/summary-config", { signal });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const config = (await response.json()) as SummaryLlmConfigView;
      if (!signal?.aborted) {
        setSummaryConfig(config);
      }
      return config;
    } catch (error) {
      if (!signal?.aborted) {
        setSummaryConfigError(error instanceof Error ? error.message : t("summaryConfigLoadFailed"));
      }
      return null;
    } finally {
      if (!signal?.aborted) {
        setIsSummaryConfigLoading(false);
      }
    }
  }, [locale, t]);
  const loadAuthStatus = useCallback(async (signal?: AbortSignal): Promise<AuthStatusResponse | null> => {
    setIsAuthLoading(true);
    setAuthError("");

    try {
      const response = await apiFetch("/api/auth/status", { signal });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const status = (await response.json()) as AuthStatusResponse;
      setAuthStatus(status);
      return status;
    } catch (error) {
      if (signal?.aborted) {
        return null;
      }

      setAuthError(error instanceof Error ? error.message : t("authStatusLoadFailed"));
      return null;
    } finally {
      if (!signal?.aborted) {
        setIsAuthLoading(false);
      }
    }
  }, [locale, t]);

  const saveProjectSnapshot = useCallback(async (editor: Editor): Promise<void> => {
    if (isHostSessionBlocked) {
      return;
    }

    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    setSaveStatus("saving");
    setSaveError("");

    try {
      const response = await apiFetch("/api/project", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          snapshot: filterLoadingPlaceholdersFromSnapshot(editor.getSnapshot())
        })
      });

      if (!response.ok) {
        throw new Error(`Project save failed with ${response.status}`);
      }

      if (saveRequestRef.current === requestId) {
        setSaveStatus("saved");
      }
    } catch {
      if (saveRequestRef.current === requestId) {
        setSaveStatus("error");
        setSaveError(t("autosaveFailed"));
      }
    }
  }, [isHostSessionBlocked, t]);

  const panelStatus = useMemo<PanelStatus | null>(() => {
    if (isGenerating) {
      return {
        tone: "progress",
        message: t("generationActiveTasks", { count: activeGenerationCount }),
        testId: "generation-progress"
      };
    }

    if (generationError) {
      return {
        tone: "error",
        message: generationError,
        testId: "generation-error"
      };
    }

    if (shouldShowValidation && validationMessage) {
      return {
        tone: "warning",
        message: validationMessage,
        testId: "validation-message"
      };
    }

    if (generationWarning) {
      return {
        tone: "warning",
        message: generationWarning,
        testId: "generation-warning"
      };
    }

    if (generationMessage) {
      return {
        tone: "success",
        message: generationMessage,
        testId: "generation-message"
      };
    }

    return null;
  }, [
    activeGenerationCount,
    generationError,
    generationMessage,
    generationWarning,
    isGenerating,
    shouldShowValidation,
    t,
    validationMessage
  ]);

  useEffect(() => {
    const updateRoute = (): void => {
      setRoute(routeFromLocation(isAiCoveMode ? "canvas" : "home"));
    };

    window.addEventListener("popstate", updateRoute);
    return () => {
      window.removeEventListener("popstate", updateRoute);
    };
  }, [isAiCoveMode]);

  useEffect(() => {
    return () => {
      for (const task of activeGenerationsRef.current.values()) {
        task.controller.abort();
      }
      activeGenerationsRef.current.clear();
      agentSocketRef.current?.close();
      agentSocketRef.current = null;
      agentSocketOpenPromiseRef.current = null;
      window.clearInterval(agentSocketPingTimerRef.current);
      agentSocketPingTimerRef.current = undefined;
      window.clearTimeout(agentSocketReconnectTimerRef.current);
      agentSocketReconnectTimerRef.current = undefined;
      agentSocketReconnectDeadlineRef.current = undefined;
      agentSocketReconnectDelayRef.current = AGENT_SOCKET_RECONNECT_INITIAL_MS;
      agentConnectionIdRef.current = null;
      activeAgentRunIdRef.current = null;
      agentJobPlaceholdersRef.current.clear();
      agentOutputPlacementCountsRef.current.clear();
      for (const timer of regionFocusFrameTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      regionFocusFrameTimersRef.current.clear();
      for (const timer of regionFocusPreviewTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      regionFocusPreviewTimersRef.current.clear();
      window.clearTimeout(agentHistorySaveTimerRef.current);
      agentHistorySaveTimerRef.current = undefined;
      window.clearTimeout(agentCopyResetTimerRef.current);
      window.clearTimeout(codexPollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadHostSession(): Promise<void> {
      try {
        const response = await apiFetch("/api/host/session", { signal: controller.signal });
        if (!response.ok) {
          const message = response.status === 401 ? await readErrorMessage(response, locale, t) : t("hostSessionLoadFailed");
          setHostSessionError(message);
          setSaveStatus("error");
          setSaveError(message);
          setAuthError(message);
          setAgentConfigError(message);
          setSummaryConfigError(message);
          setIsProjectLoaded(true);
          setIsAuthLoading(false);
          setIsAgentConfigLoading(false);
          setIsSummaryConfigLoading(false);
          return;
        }

        const session = (await response.json()) as { adapter?: { mode?: string } };
        if (!controller.signal.aborted && isHostedAiCoveAdapterMode(session.adapter?.mode)) {
          setIsAiCoveMode(true);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : t("hostSessionLoadFailed");
          setHostSessionError(message);
          setSaveStatus("error");
          setSaveError(message);
          setAuthError(message);
          setAgentConfigError(message);
          setSummaryConfigError(message);
          setIsProjectLoaded(true);
          setIsAuthLoading(false);
          setIsAgentConfigLoading(false);
          setIsSummaryConfigLoading(false);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsHostSessionChecked(true);
        }
      }
    }

    void loadHostSession();

    return () => {
      controller.abort();
    };
  }, [locale, t]);

  useEffect(() => {
    if (!isHostSessionChecked || isHostSessionBlocked) {
      return;
    }

    const controller = new AbortController();

    async function loadProject(): Promise<void> {
      setSaveStatus("loading");
      setSaveError("");

      let hostAuthError = "";
      try {
        const response = await apiFetch("/api/project", {
          signal: controller.signal
        });

        if (!response.ok) {
          if (response.status === 401) {
            hostAuthError = await readErrorMessage(response, locale, t);
            setHostSessionError(hostAuthError);
            setAuthError(hostAuthError);
            setAgentConfigError(hostAuthError);
            setSummaryConfigError(hostAuthError);
            setIsAuthLoading(false);
            setIsAgentConfigLoading(false);
            setIsSummaryConfigLoading(false);
          }
          throw new Error(`Project load failed with ${response.status}`);
        }

        const project = (await response.json()) as ProjectState;
        const snapshot = filterLoadingPlaceholdersFromSnapshot(project.snapshot);
        if (isPersistedSnapshot(snapshot)) {
          setProjectSnapshot(snapshot);
        }
        setGenerationHistory(project.history);
        setSaveStatus("saved");
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setSaveStatus("error");
        setSaveError(hostAuthError || t("projectLoadFailed"));
      } finally {
        if (!controller.signal.aborted) {
          setIsProjectLoaded(true);
        }
      }
    }

    void loadProject();

    return () => {
      controller.abort();
    };
  }, [isHostSessionBlocked, isHostSessionChecked, locale, t]);

  useEffect(() => {
    if (!isHostSessionChecked || isHostSessionBlocked) {
      return;
    }

    const controller = new AbortController();

    void loadAuthStatus(controller.signal);

    return () => {
      controller.abort();
    };
  }, [isHostSessionBlocked, isHostSessionChecked, loadAuthStatus]);

  useEffect(() => {
    if (!isHostSessionChecked || isHostSessionBlocked) {
      return;
    }

    const controller = new AbortController();

    void Promise.all([loadAgentConfig(controller.signal), loadSummaryConfig(controller.signal)]);

    return () => {
      controller.abort();
    };
  }, [isHostSessionBlocked, isHostSessionChecked, loadAgentConfig, loadSummaryConfig]);

  useEffect(() => {
    if (generationMode !== "reference") {
      setReferenceSelection(missingReferenceSelection(t));
      setRegionPromptItems([]);
      setPromptPreviewTab("edit");
    }
    setManualRegionDraft(null);
    setRegionPromptFlights([]);
    setArrivingRegionPromptIds(new Set());
  }, [generationMode, t]);

  useEffect(() => {
    if (!isRegionAnnotationActive) {
      setPromptPreviewTab("edit");
    }
  }, [isRegionAnnotationActive]);

  useEffect(() => {
    const updateModifierState = (event: KeyboardEvent): void => {
      setIsRegionModifierPressed(event.metaKey || event.ctrlKey);
    };
    const clearModifierState = (): void => setIsRegionModifierPressed(false);

    window.addEventListener("keydown", updateModifierState);
    window.addEventListener("keyup", updateModifierState);
    window.addEventListener("blur", clearModifierState);

    return () => {
      window.removeEventListener("keydown", updateModifierState);
      window.removeEventListener("keyup", updateModifierState);
      window.removeEventListener("blur", clearModifierState);
    };
  }, []);

  useEffect(() => {
    regionCanvasPointerDownRef.current = handleCanvasRegionPointerDown;
  });

  useEffect(() => {
    const transcript = agentTranscriptRef.current;
    if (!transcript) {
      return;
    }

    transcript.scrollTop = transcript.scrollHeight;
  }, [agentMessages]);

  useEffect(() => {
    if (!manualRegionDraft) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      manualRegionInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [manualRegionDraft?.id]);

  useEffect(() => {
    if (!currentAgentConversationId || agentMessages.length === 0) {
      return;
    }

    window.clearTimeout(agentHistorySaveTimerRef.current);
    agentHistorySaveTimerRef.current = window.setTimeout(() => {
      agentHistorySaveTimerRef.current = undefined;
      void saveAgentConversationNow(currentAgentConversationId, agentMessages);
    }, AGENT_HISTORY_SAVE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(agentHistorySaveTimerRef.current);
      agentHistorySaveTimerRef.current = undefined;
    };
  }, [agentMessages, currentAgentConversationId]);

  useEffect(() => {
    if (route === "gallery") {
      return;
    }

    if (isAiCoveMode && route === "home") {
      navigateToRoute("canvas", { replace: true });
      return;
    }

    if (isAuthLoading || !authStatus) {
      return;
    }

    if (route === "home" && hasGenerationProvider && shouldAutoOpenCanvasRef.current) {
      shouldAutoOpenCanvasRef.current = false;
      navigateToRoute("canvas", { replace: true });
    }
  }, [authStatus, hasGenerationProvider, isAiCoveMode, isAuthLoading, navigateToRoute, route]);

  useEffect(() => {
    if (
      !shouldAutoOpenProviderOnboarding({
        authProvider: authStatus?.provider ?? null,
        dismissedInPageSession: providerOnboardingDismissedRef.current,
        isProviderConfigDialogOpen,
        isAuthLoading,
        route
      })
    ) {
      return;
    }

    setProviderConfigInitialTab("image");
    setProviderConfigDialogMode("onboarding");
    setIsProviderConfigDialogOpen(true);
  }, [authStatus?.provider, isAuthLoading, isProviderConfigDialogOpen, route]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadStorageConfig(): Promise<void> {
      try {
        const response = await apiFetch("/api/storage/config", {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(`Storage config load failed with ${response.status}`);
        }

        const config = (await response.json()) as StorageConfigResponse;
        if (controller.signal.aborted) {
          return;
        }

        setStorageConfig(config);
        setStorageForm(storageConfigToForm(config));
        setStorageSecretTouched({ cos: false, s3: false });
      } catch {
        if (!controller.signal.aborted) {
          setStorageError(t("storageLoadFailed"));
        }
      }
    }

    void loadStorageConfig();

    return () => {
      controller.abort();
    };
  }, [t]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_DRAWER_MEDIA_QUERY);
    const updateDrawerMode = (): void => {
      setIsMobileDrawer(mediaQuery.matches);
    };

    updateDrawerMode();
    mediaQuery.addEventListener("change", updateDrawerMode);

    return () => {
      mediaQuery.removeEventListener("change", updateDrawerMode);
    };
  }, [t]);

  const closeAiPanel = useCallback((): void => {
    setIsAiPanelOpen(false);
    window.requestAnimationFrame(() => {
      canvasShellRef.current?.focus({ preventScroll: true });
    });
  }, []);

  function openStorageDialog(): void {
    setStorageForm(storageConfigToForm(storageConfig));
    setStorageSecretTouched({ cos: false, s3: false });
    setStorageError("");
    setStorageMessage("");
    setIsStorageDialogOpen(true);
  }

  function closeStorageDialog(): void {
    setIsStorageDialogOpen(false);
    setStorageError("");
    setStorageMessage("");
  }

  function closeProviderConfigDialog(): void {
    if (providerConfigDialogMode === "onboarding") {
      providerOnboardingDismissedRef.current = true;
    }
    setIsProviderConfigDialogOpen(false);
    setProviderConfigInitialTab("image");
    setProviderConfigDialogMode("default");
  }

  function openProviderConfigDialog(tab: ProviderConfigTab = "image"): void {
    setProviderConfigInitialTab(tab);
    setProviderConfigDialogMode("default");
    setIsProviderConfigDialogOpen(true);
  }

  function openProviderConfigOnboarding(tab: ProviderConfigTab = "image"): void {
    setProviderConfigInitialTab(tab);
    setProviderConfigDialogMode("onboarding");
    setIsProviderConfigDialogOpen(true);
  }

  function closeSavedProviderOnboarding(): void {
    providerOnboardingDismissedRef.current = true;
    setIsProviderConfigDialogOpen(false);
    setProviderConfigInitialTab("image");
    setProviderConfigDialogMode("default");
  }

  async function startCodexLogin(): Promise<void> {
    window.clearTimeout(codexPollTimerRef.current);
    setIsCodexLoginOpen(true);
    setCodexDevice(null);
    setCodexLoginStatus("starting");
    setCodexLoginMessage("");
    setAuthError("");

    try {
      const response = await apiFetch("/api/auth/codex/device/start", {
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const device = (await response.json()) as CodexDeviceStartResponse;
      setCodexDevice(device);
      setCodexLoginStatus("pending");
      setCodexLoginMessage(t("codexPendingAuth"));
      scheduleCodexPoll(device, device.interval);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("codexLoginFailedToStart");
      setCodexLoginStatus("error");
      setCodexLoginMessage(message);
      setAuthError(message);
    }
  }

  async function pollCodexLogin(device: CodexDeviceStartResponse): Promise<void> {
    try {
      const response = await apiFetch("/api/auth/codex/device/poll", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          deviceAuthId: device.deviceAuthId,
          userCode: device.userCode
        })
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const result = (await response.json()) as CodexDevicePollResponse;
      if (result.status === "authorized") {
        setCodexLoginStatus("authorized");
        setCodexLoginMessage(t("codexLoginAuthorized"));
        if (result.auth) {
          setAuthStatus(result.auth);
        } else {
          void loadAuthStatus();
        }
        window.setTimeout(() => {
          setIsCodexLoginOpen(false);
          navigateToRoute("canvas");
        }, 700);
        return;
      }

      if (result.status === "pending") {
        setCodexLoginStatus("pending");
        scheduleCodexPoll(device, result.interval ?? device.interval);
        return;
      }

      setCodexLoginStatus(result.status);
      setCodexLoginMessage(result.message ?? t("codexLoginIncomplete"));
      void loadAuthStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("codexLoginPollingFailed");
      setCodexLoginStatus("error");
      setCodexLoginMessage(message);
      setAuthError(message);
    }
  }

  function scheduleCodexPoll(device: CodexDeviceStartResponse, intervalSeconds: number): void {
    window.clearTimeout(codexPollTimerRef.current);
    const delay = Math.max(1, intervalSeconds) * 1000;
    codexPollTimerRef.current = window.setTimeout(() => {
      void pollCodexLogin(device);
    }, delay);
  }

  function closeCodexLoginDialog(): void {
    window.clearTimeout(codexPollTimerRef.current);
    setIsCodexLoginOpen(false);
  }

  async function logoutCodexSession(): Promise<void> {
    window.clearTimeout(codexPollTimerRef.current);
    setIsAuthLoading(true);
    setAuthError("");

    try {
      const response = await apiFetch("/api/auth/codex/logout", {
        method: "POST"
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const result = (await response.json()) as CodexLogoutResponse;
      setAuthStatus(result.auth);
      setCodexDevice(null);
      setCodexLoginStatus("idle");
      setCodexLoginMessage("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : t("codexLogoutFailed"));
    } finally {
      setIsAuthLoading(false);
    }
  }

  async function copyCodexUserCode(): Promise<void> {
    if (!codexDevice) {
      return;
    }

    await writeClipboardText(codexDevice.userCode).catch(() => undefined);
  }

  function updateStorageForm(patch: Partial<StorageConfigFormState>): void {
    setStorageForm((current) => ({
      ...current,
      ...patch
    }));
    setStorageError("");
    setStorageMessage("");
  }

  function updateStorageProvider(provider: CloudStorageProvider): void {
    setStorageForm((current) => ({
      ...current,
      provider
    }));
    setStorageError("");
    setStorageMessage("");
  }

  function updateStorageCosForm(patch: Partial<StorageConfigFormState["cos"]>): void {
    setStorageForm((current) => ({
      ...current,
      cos: {
        ...current.cos,
        ...patch
      }
    }));
    setStorageError("");
    setStorageMessage("");
  }

  function updateStorageS3Form(patch: Partial<StorageConfigFormState["s3"]>): void {
    setStorageForm((current) => ({
      ...current,
      s3: {
        ...current.s3,
        ...patch
      }
    }));
    setStorageError("");
    setStorageMessage("");
  }

  async function testStorageSettings(): Promise<void> {
    setIsStorageTesting(true);
    setStorageError("");
    setStorageMessage("");

    try {
      const response = await apiFetch("/api/storage/config/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(
          storageConfigRequestBody(storageForm, {
            preserveSecret: shouldPreserveStorageSecret(storageForm, storageConfig, storageSecretTouched),
            forceEnabled: true
          })
        )
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const result = (await response.json()) as StorageTestResult;
      if (!result.ok) {
        setStorageError(result.message);
        return;
      }

      setStorageMessage(result.message);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : t("storageTestFailed"));
    } finally {
      setIsStorageTesting(false);
    }
  }

  async function saveStorageSettings(): Promise<void> {
    setIsStorageSaving(true);
    setStorageError("");
    setStorageMessage("");

    try {
      const response = await apiFetch("/api/storage/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(
          storageConfigRequestBody(storageForm, {
            preserveSecret: shouldPreserveStorageSecret(storageForm, storageConfig, storageSecretTouched)
          })
        )
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const config = (await response.json()) as StorageConfigResponse;
      setStorageConfig(config);
      setStorageForm(storageConfigToForm(config));
      setStorageSecretTouched({ cos: false, s3: false });
      setStorageMessage(t("storageSaved"));
      setGenerationMessage(config.enabled ? t("storageEnabledMessage") : t("storageDisabledMessage"));
      setGenerationWarning("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : t("storageSaveFailed"));
    } finally {
      setIsStorageSaving(false);
    }
  }

  useEffect(() => {
    if (!isMobileDrawer || !isAiPanelOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAiPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeAiPanel, isAiPanelOpen, isMobileDrawer]);

  useEffect(() => {
    if (!isMobileDrawer || !isAiPanelOpen) {
      return;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      panelCloseButtonRef.current?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
    };
  }, [isAiPanelOpen, isMobileDrawer]);

  useEffect(() => {
    const editor = editorRef.current;
    const nextReferenceSelection = editor ? resolveReferenceSelection(editor, t) : missingReferenceSelection(t);
    setReferenceSelection((currentSelection) =>
      areReferenceSelectionsEqual(currentSelection, nextReferenceSelection) ? currentSelection : nextReferenceSelection
    );
    const nextAgentSelection = editor ? resolveAgentReferenceSelection(editor, t) : emptyAgentReferenceSelection(t);
    setAgentReferenceSelection((currentSelection) =>
      areAgentReferenceSelectionsEqual(currentSelection, nextAgentSelection) ? currentSelection : nextAgentSelection
    );
  }, [t]);

  const handleEditorMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    localizeDefaultPageName(editor, locale);
    if (!editor.user.getIsSnapMode()) {
      editor.user.updateUserPreferences({ isSnapMode: true });
    }

    let referenceSelectionFrame: number | undefined;
    const commitReferenceSelection = (): void => {
      const nextSelection = resolveReferenceSelection(editor, t);
      setReferenceSelection((currentSelection) =>
        areReferenceSelectionsEqual(currentSelection, nextSelection) ? currentSelection : nextSelection
      );
      const nextAgentSelection = resolveAgentReferenceSelection(editor, t);
      setAgentReferenceSelection((currentSelection) =>
        areAgentReferenceSelectionsEqual(currentSelection, nextAgentSelection) ? currentSelection : nextAgentSelection
      );
    };
    const updateReferenceSelection = (): void => {
      if (referenceSelectionFrame !== undefined) {
        return;
      }

      referenceSelectionFrame = window.requestAnimationFrame(() => {
        referenceSelectionFrame = undefined;
        commitReferenceSelection();
      });
    };

    const removeListener = editor.store.listen(
      () => {
        if (isHostSessionBlocked) {
          return;
        }

        window.clearTimeout(saveTimerRef.current);
        setSaveStatus((status) => (status === "pending" ? status : "pending"));
        setSaveError((error) => (error ? "" : error));
        saveTimerRef.current = window.setTimeout(() => {
          void saveProjectSnapshot(editor);
        }, AUTOSAVE_DEBOUNCE_MS);
      },
      {
        source: "user",
        scope: "document"
      }
    );
    const removeReferenceStoreListener = editor.store.listen(updateReferenceSelection, {
      source: "all",
      scope: "all"
    });
    const handleRegionPointerDown = (event: PointerEvent): void => {
      regionCanvasPointerDownRef.current?.(event);
    };
    editor.getContainer().addEventListener("pointerdown", handleRegionPointerDown, { capture: true });
    editor.on("change", updateReferenceSelection);
    deleteAgentPlanNodes(editor);
    commitReferenceSelection();
    recoverActiveGenerationPolling(editor);

    return () => {
      window.clearTimeout(saveTimerRef.current);
      if (referenceSelectionFrame !== undefined) {
        window.cancelAnimationFrame(referenceSelectionFrame);
      }
      if (editorRef.current === editor) {
        editorRef.current = null;
      }
      editor.getContainer().removeEventListener("pointerdown", handleRegionPointerDown, { capture: true });
      editor.off("change", updateReferenceSelection);
      removeReferenceStoreListener();
      removeListener();
    };
  }, [isHostSessionBlocked, locale, saveProjectSnapshot, t]);

  function selectScenePreset(nextPresetId: string): void {
    if (nextPresetId === CUSTOM_SIZE_PRESET_ID) {
      setSizePresetId(CUSTOM_SIZE_PRESET_ID);
      return;
    }

    const preset = SIZE_PRESETS.find((item) => item.id === nextPresetId);
    if (!preset) {
      return;
    }

    setSizePresetId(preset.id);
    setWidth(preset.width);
    setHeight(preset.height);
  }

  function updateWidth(value: string): void {
    setWidth(normalizeDimension(value));
    setSizePresetId(CUSTOM_SIZE_PRESET_ID);
  }

  function updateHeight(value: string): void {
    setHeight(normalizeDimension(value));
    setSizePresetId(CUSTOM_SIZE_PRESET_ID);
  }

  function applyPromptStarter(starter: string): void {
    setPrompt(starter);
    setGenerationError("");
    setGenerationMessage("");
    setGenerationWarning("");
  }

  function upsertGenerationHistoryRecord(record: GenerationRecord, options: { promote?: boolean } = {}): void {
    setGenerationHistory((history) => {
      const existingIndex = history.findIndex((item) => item.id === record.id);
      if (existingIndex >= 0 && !options.promote) {
        return history.map((item) => (item.id === record.id ? record : item));
      }

      return [record, ...history.filter((item) => item.id !== record.id)].slice(0, 20);
    });
  }

  async function fetchGenerationRecord(recordId: string, signal: AbortSignal): Promise<GenerationRecord> {
    const response = await apiFetch(`/api/generations/${encodeURIComponent(recordId)}`, {
      signal
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response, locale, t));
    }

    const body = (await response.json()) as unknown;
    if (!isGenerationResponse(body)) {
      throw new Error(t("generationInvalidResponse"));
    }

    return body.record;
  }

  function finishPolledGeneration(record: GenerationRecord, placeholderSet: ActiveGenerationPlaceholders, notify: boolean): void {
    const editor = editorRef.current;
    const livePlaceholderSet = editor ? placeholderSetForGenerationRecord(editor, record) ?? placeholderSet : placeholderSet;
    const insertedCount = editor && livePlaceholderSet.placements.length > 0 ? replaceGenerationPlaceholders(editor, livePlaceholderSet, record, t) : 0;
    if (editor && livePlaceholderSet.placements.length > 0) {
      void saveProjectSnapshot(editor);
    }
    const failedCount =
      record.outputs.filter((output) => output.status === "failed").length +
      Math.max(0, livePlaceholderSet.placements.length - record.outputs.length);
    const cloudFailedCount = cloudFailureCount(record);

    if (!notify) {
      return;
    }

    if (insertedCount > 0) {
      if (cloudFailedCount > 0 || failedCount > 0) {
        setGenerationWarning(generationWarningMessage(record, insertedCount, failedCount, cloudFailedCount, t));
      } else {
        setGenerationMessage(t("generationImageInserted", { count: insertedCount }));
      }
      showGenerationCompleteNotification(record, insertedCount, failedCount, t);
      return;
    }

    if (record.status === "failed" || record.status === "cancelled") {
      setGenerationError(generationFailureMessage(record, t));
    }
  }

  function startGenerationPolling(
    record: GenerationRecord,
    placeholderSet: ActiveGenerationPlaceholders | undefined,
    options: { notify?: boolean } = {}
  ): void {
    if (!isActiveGenerationRecord(record) || activeGenerationsRef.current.has(record.id)) {
      return;
    }

    const editor = editorRef.current;
    const controller = new AbortController();
    activeGenerationsRef.current.set(record.id, {
      requestId: record.id,
      controller,
      placeholderSet: placeholderSet ?? (editor ? placeholderSetForGenerationRecord(editor, record) : undefined) ?? {
        requestId: record.id,
        placements: []
      }
    });
    setActiveGenerationCount(activeGenerationsRef.current.size);
    void pollGenerationUntilComplete(record.id, options.notify === true);
  }

  async function pollGenerationUntilComplete(recordId: string, notify: boolean): Promise<void> {
    while (true) {
      const task = activeGenerationsRef.current.get(recordId);
      if (!task) {
        return;
      }

      try {
        await waitForGenerationPollInterval(task.controller.signal);
        const record = await fetchGenerationRecord(recordId, task.controller.signal);
        upsertGenerationHistoryRecord(record);

        if (!isTerminalGenerationRecord(record)) {
          continue;
        }

        await preloadGenerationRecordPreviews(record, task.controller.signal);
        finishPolledGeneration(record, task.placeholderSet, notify);
        activeGenerationsRef.current.delete(recordId);
        setActiveGenerationCount(activeGenerationsRef.current.size);
        return;
      } catch (error) {
        if (task.controller.signal.aborted) {
          return;
        }

        if (notify) {
          setGenerationError(error instanceof Error ? error.message : t("generationErrorDefault"));
        }
      }
    }
  }

  function recoverActiveGenerationPolling(editor: Editor | null = editorRef.current): void {
    if (!editor) {
      return;
    }

    generationHistoryRef.current.forEach((record) => {
      const placeholderSet = placeholderSetForGenerationRecord(editor, record);
      if (isActiveGenerationRecord(record)) {
        startGenerationPolling(record, placeholderSet, { notify: false });
        return;
      }

      if (placeholderSet && isTerminalGenerationRecord(record)) {
        finishPolledGeneration(record, placeholderSet, false);
      }
    });
  }

  useEffect(() => {
    if (!isProjectLoaded) {
      return;
    }

    recoverActiveGenerationPolling();
  }, [generationHistory, isProjectLoaded]);

  async function executeGeneration(
    input: GenerationSubmitInput,
    requestMode: GenerationMode,
    resolveReference?: (signal: AbortSignal) => Promise<GenerationReferenceInput | undefined>,
    referenceAssetIds?: string[]
  ): Promise<void> {
    if (generationSubmitAction === "configure-image-model") {
      openProviderConfigOnboarding("image");
      return;
    }

    setGenerationError("");
    setGenerationMessage("");
    setGenerationWarning("");

    const inputValidationMessage = generationValidationMessage(input.prompt, input.size.width, input.size.height, t, locale);
    if (inputValidationMessage) {
      setGenerationWarning(inputValidationMessage);
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      setGenerationError(t("generationCanvasNotReady"));
      return;
    }

    requestGenerationNotificationPermission();

    const controller = new AbortController();
    const generationId = crypto.randomUUID();
    const placeholderSet = createGenerationPlaceholders(editor, input, generationId, {
      selectPlaceholders: requestMode !== "reference"
    });
    const temporaryRecord = createTemporaryGenerationRecord({
      requestId: generationId,
      submitInput: input,
      requestMode,
      referenceAssetIds
    });

    activeGenerationsRef.current.set(generationId, {
      requestId: generationId,
      controller,
      placeholderSet
    });
    setActiveGenerationCount(activeGenerationsRef.current.size);
    upsertGenerationHistoryRecord(temporaryRecord, { promote: true });
    void saveProjectSnapshot(editor);

    try {
      const referenceForRequest = requestMode === "reference" ? await resolveReference?.(controller.signal) : undefined;
      if (
        requestMode === "reference" &&
        (!referenceForRequest || (!referenceForRequest.referenceImages?.length && !referenceForRequest.referenceAssetIds?.length))
      ) {
        throw new Error(t("generationRequireReference", { max: MAX_REFERENCE_IMAGES }));
      }

      const requestBody: Record<string, unknown> = {
        clientRequestId: generationId,
        prompt: input.prompt.trim(),
        presetId: input.presetId,
        sizePresetId: input.sizePresetId,
        size: input.size,
        quality: input.quality,
        outputFormat: input.outputFormat,
        count: input.count
      };

      if (requestMode === "reference" && referenceForRequest) {
        if (referenceForRequest.referenceImages?.length) {
          requestBody.referenceImages = referenceForRequest.referenceImages;
        }
        if (referenceForRequest.referenceAssetIds?.length) {
          requestBody.referenceAssetIds = referenceForRequest.referenceAssetIds;
        }
      }

      const response = await apiFetch(requestMode === "reference" ? "/api/images/edit" : "/api/images/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const body = (await response.json()) as unknown;
      if (!isGenerationResponse(body)) {
        throw new Error(t("generationInvalidResponse"));
      }

      if (controller.signal.aborted || !activeGenerationsRef.current.has(generationId)) {
        return;
      }

      upsertGenerationHistoryRecord(body.record);
      void saveProjectSnapshot(editor);
      if (isTerminalGenerationRecord(body.record)) {
        await preloadGenerationRecordPreviews(body.record, controller.signal);
        finishPolledGeneration(body.record, placeholderSet, true);
        if (activeGenerationsRef.current.delete(generationId)) {
          setActiveGenerationCount(activeGenerationsRef.current.size);
        }
        return;
      }

      void pollGenerationUntilComplete(generationId, true);
    } catch (error) {
      if (controller.signal.aborted || !activeGenerationsRef.current.has(generationId)) {
        return;
      }

      const message = error instanceof Error ? error.message : t("generationErrorDefault");
      try {
        const recoveredRecord = await fetchGenerationRecord(generationId, controller.signal);
        upsertGenerationHistoryRecord(recoveredRecord);
        if (isTerminalGenerationRecord(recoveredRecord)) {
          await preloadGenerationRecordPreviews(recoveredRecord, controller.signal);
          finishPolledGeneration(recoveredRecord, placeholderSet, true);
          if (activeGenerationsRef.current.delete(generationId)) {
            setActiveGenerationCount(activeGenerationsRef.current.size);
          }
          return;
        }

        void pollGenerationUntilComplete(generationId, true);
        return;
      } catch {
        if (controller.signal.aborted || !activeGenerationsRef.current.has(generationId)) {
          return;
        }
      }

      markGenerationPlaceholdersFailed(editor, placeholderSet, message);
      void saveProjectSnapshot(editor);
      setGenerationHistory((history) =>
        history.map((record) => (record.id === temporaryRecord.id ? { ...record, status: "failed", error: message } : record))
      );
      setGenerationError(message);
      if (activeGenerationsRef.current.delete(generationId)) {
        setActiveGenerationCount(activeGenerationsRef.current.size);
      }
    }
  }

  function beginRegionPromptFlight(itemId: string, start?: ClientPoint): void {
    const targetRect = promptRegionEditorRef.current?.getTargetRect() ?? promptInputRef.current?.getBoundingClientRect();
    if (!start || !targetRect) {
      return;
    }

    const flight: RegionPromptFlight = {
      id: crypto.randomUUID(),
      itemId,
      fromX: start.x,
      fromY: start.y,
      toX: targetRect.right - 18,
      toY: targetRect.bottom - 18
    };

    setArrivingRegionPromptIds((current) => new Set(current).add(itemId));
    setRegionPromptFlights((flights) => [...flights, flight]);
  }

  function finishRegionPromptFlight(flight: RegionPromptFlight): void {
    setRegionPromptFlights((flights) => flights.filter((item) => item.id !== flight.id));
    setArrivingRegionPromptIds((current) => {
      const next = new Set(current);
      next.delete(flight.itemId);
      return next;
    });
  }

  function beginRegionFocusFrame(input: {
    imageShape: TLImageShape;
    itemId: string;
    pointer: ClientPoint;
    region: NormalizedImageRegion;
  }): void {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const rect = regionFocusRectFromImageShape(editor, input.imageShape, input.region, input.pointer);
    const id = crypto.randomUUID();
    setRegionFocusFrames((frames) => [...frames, { id, itemId: input.itemId, ...rect }]);
    const timer = window.setTimeout(() => {
      regionFocusFrameTimersRef.current.delete(id);
      setRegionFocusFrames((frames) => frames.filter((frame) => frame.id !== id));
    }, 1100);
    regionFocusFrameTimersRef.current.set(id, timer);
  }

  function regionFocusPreviewFromItem(
    item: RegionPromptItem,
    anchor: RegionFocusAnchor,
    origin: RegionFocusPreview["origin"]
  ): RegionFocusPreview {
    return {
      id: crypto.randomUUID(),
      itemId: item.id,
      anchor,
      referenceName: item.reference.name,
      cropDataUrl: item.cropDataUrl,
      cropAspectRatio: item.cropAspectRatio ?? regionPreviewAspectRatio(item.region, item.reference),
      label: item.label,
      description: item.description,
      precision: regionPrecisionText(item.region, item.reference, locale),
      status: item.status === "ready" ? "ready" : "summarizing",
      collapsed: false,
      dismissing: false,
      origin
    };
  }

  function showRegionFocusPreview(input: {
    itemId: string;
    rect: DOMRect;
    item?: RegionPromptItem;
    origin: RegionFocusPreview["origin"];
  }): void {
    const item = input.item ?? regionPromptItemsRef.current.find((candidate) => candidate.id === input.itemId);
    if (!item) {
      return;
    }

    if (input.origin === "hover") {
      const timer = regionFocusPreviewTimersRef.current.get(input.itemId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        regionFocusPreviewTimersRef.current.delete(input.itemId);
      }
    }

    const nextPreview = regionFocusPreviewFromItem(item, regionFocusAnchorFromRect(input.rect), input.origin);
    setRegionFocusPreviews((previews) => {
      const existing = previews.find((preview) => preview.itemId === input.itemId);
      const nextOrigin = existing?.origin === "auto" && existing.status === "summarizing" ? "auto" : input.origin;
      const updatedPreview: RegionFocusPreview = {
        ...nextPreview,
        id: existing?.id ?? nextPreview.id,
        dismissing: input.origin === "hover" ? false : existing?.dismissing ?? nextPreview.dismissing,
        origin: nextOrigin
      };
      const others = previews
        .filter((preview) => preview.itemId !== input.itemId)
        .map((preview) => ({ ...preview, collapsed: true }));
      return [...others, updatedPreview].slice(-4);
    });
  }

  function showRegionFocusPreviewWhenTokenReady(item: RegionPromptItem, attempt = 0, onShown?: () => void): void {
    const rect = promptRegionEditorRef.current?.getRegionTokenRect(item.id);
    if (rect) {
      showRegionFocusPreview({ itemId: item.id, item, origin: "auto", rect });
      onShown?.();
      return;
    }
    if (attempt >= 8) {
      return;
    }
    window.requestAnimationFrame(() => showRegionFocusPreviewWhenTokenReady(item, attempt + 1, onShown));
  }

  function updateRegionFocusPreview(itemId: string, patch: Partial<RegionFocusPreview>): void {
    setRegionFocusPreviews((previews) =>
      previews.map((preview) =>
        preview.itemId === itemId
          ? {
              ...preview,
              ...patch
            }
          : preview
      )
    );
  }

  function dismissRegionFocusPreview(itemId: string, delayMs = 0, markDismissing = false): void {
    const previousTimer = regionFocusPreviewTimersRef.current.get(itemId);
    if (previousTimer !== undefined) {
      window.clearTimeout(previousTimer);
      regionFocusPreviewTimersRef.current.delete(itemId);
    }
    if (markDismissing) {
      setRegionFocusPreviews((previews) =>
        previews.map((preview) => (preview.itemId === itemId ? { ...preview, dismissing: true, collapsed: false } : preview))
      );
    }
    const timer = window.setTimeout(() => {
      regionFocusPreviewTimersRef.current.delete(itemId);
      setRegionFocusPreviews((previews) => previews.filter((preview) => preview.itemId !== itemId));
    }, delayMs);
    regionFocusPreviewTimersRef.current.set(itemId, timer);
  }

  function handleShowRegionFocusPreview(id: string, rect: DOMRect): void {
    showRegionFocusPreview({ itemId: id, origin: "hover", rect });
  }

  function handleHideRegionFocusPreview(id: string): void {
    setRegionFocusPreviews((previews) =>
      previews.filter((preview) => preview.itemId !== id || preview.origin === "auto" || preview.dismissing)
    );
  }

  async function hydrateManualRegionPreview(item: RegionPromptItem, reference: ReferenceSelectionItem): Promise<void> {
    const controller = new AbortController();
    try {
      const image = await cropReferenceRegion(reference, item.region, controller.signal, t);
      const previewItem: RegionPromptItem = {
        ...item,
        cropDataUrl: image.dataUrl,
        cropAspectRatio: image.aspectRatio
      };
      if (!regionPromptItemsRef.current.some((candidate) => candidate.id === item.id)) {
        return;
      }
      setRegionPromptItems((items) =>
        items.map((candidate) =>
          candidate.id === item.id
            ? {
                ...candidate,
                cropDataUrl: image.dataUrl,
                cropAspectRatio: image.aspectRatio
              }
            : candidate
        )
      );
      updateRegionFocusPreview(item.id, {
        cropDataUrl: image.dataUrl,
        cropAspectRatio: image.aspectRatio
      });
      window.requestAnimationFrame(() => showRegionFocusPreviewWhenTokenReady(previewItem));
    } catch {
      // Manual labels should remain usable even if preview cropping is unavailable.
    }
  }

  function resizePromptInput(): void {
    const input = promptInputRef.current;
    if (!input) {
      return;
    }

    const minHeight = isRegionAnnotationActive ? 56 : 128;
    input.style.height = "auto";
    input.style.height = `${Math.max(minHeight, input.scrollHeight)}px`;
  }

  function regionPromptInsertionIndex(): number {
    const editorCursor = promptRegionEditorRef.current?.getCursorIndex() ?? promptEditorCursorIndexRef.current;
    return Math.max(0, Math.min(prompt.length, editorCursor ?? prompt.length));
  }

  function focusPromptRegionEditorAfterInsert(cursorIndex: number): void {
    pendingPromptRegionFocusRef.current = cursorIndex;
    window.requestAnimationFrame(() => {
      const editor = promptRegionEditorRef.current;
      if (!editor) {
        return;
      }
      editor.focusAtCursor(pendingPromptRegionFocusRef.current ?? cursorIndex);
      pendingPromptRegionFocusRef.current = null;
    });
  }

  const setPromptRegionEditorHandle = useCallback((editor: PromptRegionEditorHandle | null) => {
    promptRegionEditorRef.current = editor;
    if (!editor || pendingPromptRegionFocusRef.current === null) {
      return;
    }

    const cursorIndex = pendingPromptRegionFocusRef.current;
    pendingPromptRegionFocusRef.current = null;
    window.requestAnimationFrame(() => editor.focusAtCursor(cursorIndex));
  }, []);

  function insertRegionPromptItemIntoPrompt(region: RegionPromptItem, insertionIndex: number): void {
    const anchoredRegion = { ...region, insertionIndex };
    const editorResult = promptRegionEditorRef.current?.insertRegionToken(anchoredRegion, insertionIndex);
    if (editorResult) {
      promptEditorCursorIndexRef.current = editorResult.cursorIndex;
      focusPromptRegionEditorAfterInsert(editorResult.cursorIndex);
      return;
    }

    const edit = insertRegionPromptDocumentTokenAtCursor(prompt, anchoredRegion, insertionIndex);
    promptEditorCursorIndexRef.current = edit.cursorIndex;
    setPrompt(edit.prompt);
    focusPromptRegionEditorAfterInsert(edit.cursorIndex);
  }

  function handlePromptEditorChange(nextPrompt: string): void {
    setPrompt(nextPrompt);
    setRegionPromptItems((items) => {
      const nextItems = items.filter((item) => promptIncludesRegionItemToken(nextPrompt, item));
      const nextIds = new Set(nextItems.map((item) => item.id));
      setRegionFocusPreviews((previews) => previews.filter((preview) => nextIds.has(preview.itemId)));
      setRegionFocusFrames((frames) => frames.filter((frame) => nextIds.has(frame.itemId)));
      return nextItems;
    });
  }

  useEffect(() => {
    resizePromptInput();
  }, [isRegionAnnotationActive, prompt, regionPromptItems.length]);

  async function summarizeReferenceRegion(
    reference: ReferenceSelectionItem,
    region: NormalizedImageRegion,
    insertionIndex: number,
    start?: ClientPoint,
    imageShape?: TLImageShape
  ): Promise<void> {
    const itemId = crypto.randomUUID();
    const pendingRegion: RegionPromptItem = {
      id: itemId,
      mode: "auto",
      label: "",
      description: "",
      note: "",
      insertionIndex,
      region,
      reference: regionPromptReferenceFromSelection(reference),
      cropAspectRatio: regionPreviewAspectRatio(region, reference),
      status: "summarizing"
    };
    setRegionPromptItems((items) => [...items, pendingRegion]);
    insertRegionPromptItemIntoPrompt(pendingRegion, insertionIndex);
    beginRegionPromptFlight(itemId, start);
    window.requestAnimationFrame(() => showRegionFocusPreviewWhenTokenReady(pendingRegion));
    if (start && imageShape) {
      beginRegionFocusFrame({ imageShape, itemId, pointer: start, region });
    }

    try {
      const controller = new AbortController();
      const image = await cropReferenceRegion(reference, region, controller.signal, t);
      setRegionPromptItems((items) =>
        items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                cropDataUrl: image.dataUrl,
                cropAspectRatio: image.aspectRatio
              }
            : item
        )
      );
      updateRegionFocusPreview(itemId, { cropDataUrl: image.dataUrl, cropAspectRatio: image.aspectRatio });
      const body: RegionSummaryRequest = {
        image: {
          dataUrl: image.dataUrl,
          fileName: image.fileName
        },
        source: {
          width: Math.round(reference.width),
          height: Math.round(reference.height)
        },
        region,
        locale
      };

      const response = await apiFetch("/api/images/region-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const summary = (await response.json()) as RegionSummaryResponse;
      const readyRegion: RegionPromptItem = {
        id: itemId,
        mode: "auto",
        label: summary.label,
        description: summary.description,
        note: "",
        insertionIndex,
        region,
        reference: regionPromptReferenceFromSelection(reference),
        cropDataUrl: image.dataUrl,
        cropAspectRatio: image.aspectRatio,
        status: "ready"
      };
      if (!regionPromptItemsRef.current.some((item) => item.id === itemId)) {
        return;
      }
      setRegionPromptItems((items) =>
        items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                label: summary.label,
                description: summary.description,
                cropDataUrl: image.dataUrl,
                cropAspectRatio: image.aspectRatio,
                status: "ready"
              }
            : item
        )
      );
      updateRegionFocusPreview(itemId, {
        label: summary.label,
        description: summary.description,
        cropDataUrl: image.dataUrl,
        cropAspectRatio: image.aspectRatio,
        status: "ready"
      });
      dismissRegionFocusPreview(itemId, 2400, true);
      const replacedInEditor = promptRegionEditorRef.current?.replaceRegionToken(readyRegion) ?? false;
      window.requestAnimationFrame(() => showRegionFocusPreviewWhenTokenReady(readyRegion));
      if (!replacedInEditor) {
        setPrompt((currentPrompt) => {
          const replacement = replaceRegionPromptPendingToken(currentPrompt, readyRegion);
          if (replacement.changed) {
            return replacement.prompt;
          }
          if (promptIncludesRegionItemToken(currentPrompt, readyRegion)) {
            return currentPrompt;
          }
          return insertRegionPromptDocumentTokenAtCursor(currentPrompt, readyRegion, insertionIndex).prompt;
        });
      }
    } catch (error) {
      promptRegionEditorRef.current?.removeRegionToken(pendingRegion);
      setPrompt((currentPrompt) => removeRegionPromptItemToken(currentPrompt, pendingRegion));
      setRegionPromptItems((items) => items.filter((item) => item.id !== itemId));
      dismissRegionFocusPreview(itemId);
      setGenerationError(error instanceof Error ? error.message : t("regionPromptSummaryFailed"));
    }
  }

  function handleCanvasRegionPointerDown(event: PointerEvent): void {
    if (
      panelTab !== "manual" ||
      generationMode !== "reference" ||
      regionAnnotationMode === "none" ||
      event.button !== 0 ||
      (!event.metaKey && !event.ctrlKey)
    ) {
      return;
    }

    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const pointer = { x: event.clientX, y: event.clientY };
    const imageShape = getImageShapeUnderPointer(editor, pointer);
    if (!imageShape) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const reference = referenceItemForImageShape(editor, imageShape);
    if (!reference) {
      setGenerationError(t("generationSelectionUnreadable"));
      return;
    }

    const imagePoint = normalizedImagePointFromCanvasPointer(editor, imageShape, pointer);
    const region = defaultRegionForPoint(imagePoint.x, imagePoint.y);
    const insertionIndex = regionPromptInsertionIndex();
    setGenerationError("");

    if (regionAnnotationMode === "manual") {
      const draftId = crypto.randomUUID();
      beginRegionFocusFrame({ imageShape, itemId: draftId, pointer, region });
      setManualRegionDraft({
        id: draftId,
        insertionIndex,
        reference,
        region,
        x: pointer.x,
        y: pointer.y,
        label: ""
      });
      return;
    }

    if (!canUseRegionSummary) {
      setGenerationError(regionSummaryStatusCopy(regionSummaryState, t, summaryConfigError || agentConfigError));
      return;
    }

    void summarizeReferenceRegion(reference, region, insertionIndex, pointer, imageShape);
  }

  function selectRegionAnnotationMode(mode: RegionAnnotationMode): void {
    setRegionAnnotationMode(mode);
    setPromptPreviewTab("edit");
    setManualRegionDraft(null);
    setRegionPromptFlights([]);
    setRegionFocusFrames([]);
    setRegionFocusPreviews([]);
    setArrivingRegionPromptIds(new Set());
    if (mode === "none") {
      setPrompt((currentPrompt) => removeRegionPromptPendingTokens(removeRegionPromptTokens(currentPrompt, regionPromptItems)));
      setRegionPromptItems([]);
    }
  }

  function updateManualRegionDraftLabel(label: string): void {
    setManualRegionDraft((draft) => (draft ? { ...draft, label } : draft));
  }

  function confirmManualRegionDraft(): void {
    if (!manualRegionDraft) {
      return;
    }

    const label = manualRegionDraft.label.trim();
    if (!label) {
      manualRegionInputRef.current?.focus();
      return;
    }

    const item = createManualRegionPromptItem({
      id: manualRegionDraft.id,
      label,
      locale,
      reference: regionPromptReferenceFromSelection(manualRegionDraft.reference),
      region: manualRegionDraft.region
    });
    const anchoredItem = {
      ...item,
      cropAspectRatio: regionPreviewAspectRatio(manualRegionDraft.region, manualRegionDraft.reference),
      insertionIndex: manualRegionDraft.insertionIndex
    };
    const start = { x: manualRegionDraft.x, y: manualRegionDraft.y };
    insertRegionPromptItemIntoPrompt(anchoredItem, manualRegionDraft.insertionIndex);
    setRegionPromptItems((items) => [...items, anchoredItem]);
    setManualRegionDraft(null);
    beginRegionPromptFlight(anchoredItem.id, start);
    window.requestAnimationFrame(() =>
      showRegionFocusPreviewWhenTokenReady(anchoredItem, 0, () => dismissRegionFocusPreview(anchoredItem.id, 2400, true))
    );
    void hydrateManualRegionPreview(anchoredItem, manualRegionDraft.reference);
  }

  async function submitGeneration(): Promise<void> {
    if (generationSubmitAction === "configure-image-model") {
      openProviderConfigOnboarding("image");
      return;
    }

    const submittedUserPrompt = isRegionAnnotationActive ? finalRegionPromptForModel(trimmedPrompt, regionPromptItems, locale) : trimmedPrompt;
    const input: GenerationSubmitInput = {
      prompt: submittedUserPrompt,
      presetId: stylePreset,
      sizePresetId,
      size: {
        width,
        height
      },
      quality,
      outputFormat,
      count
    };

    if (generationMode === "reference") {
      const referencesForRequest = activeReferenceItems;
      await executeGeneration(input, "reference", async (signal) => {
        if (referencesForRequest.length === 0) {
          return undefined;
        }

        const referenceAssetIds = referenceAssetIdsForRequest(referencesForRequest);
        if (referenceAssetIds && !shouldSendReferenceImages(referencesForRequest)) {
          return {
            referenceAssetIds
          };
        }

        return {
          referenceImages: await Promise.all(referencesForRequest.map((reference) => readReferenceImage(reference, signal, t))),
          referenceAssetIds
        };
      }, referenceAssetIdsForRequest(referencesForRequest));
      return;
    }

    await executeGeneration(input, "text");
  }

  function cancelReferenceSelection(): void {
    editorRef.current?.selectNone();
    setReferenceSelection(missingReferenceSelection(t));
    setRegionPromptItems([]);
    setManualRegionDraft(null);
    setRegionPromptFlights([]);
    setRegionFocusFrames([]);
    setRegionFocusPreviews([]);
    setArrivingRegionPromptIds(new Set());
    setGenerationError("");
    setGenerationMessage("");
    setGenerationWarning("");
  }

  function locateHistoryRecord(record: GenerationRecord): void {
    setGenerationError("");
    setGenerationMessage("");
    setGenerationWarning("");

    const editor = editorRef.current;
    if (!editor) {
      setGenerationError(t("generationCanvasNotReady"));
      return;
    }

    const shapeId = findCanvasImageShape(editor, record);
    if (!shapeId) {
      const activeTask = activeGenerationsRef.current.get(record.id);
      const recoveredPlaceholderSet = placeholderSetForGenerationRecord(editor, record);
      const placeholderId = activeTask
        ? firstLiveGenerationPlaceholder(editor, activeTask.placeholderSet)
        : recoveredPlaceholderSet
          ? firstLiveGenerationPlaceholder(editor, recoveredPlaceholderSet)
          : undefined;
      if (!placeholderId) {
        setGenerationError(t("generationHistoryImageMissing"));
        return;
      }

      const bounds = editor.getShapePageBounds(placeholderId);
      editor.select(placeholderId);
      if (bounds) {
        editor.zoomToBounds(bounds, {
          animation: { duration: 220 },
          inset: 96
        });
      } else {
        editor.zoomToSelection({ animation: { duration: 220 } });
      }
      setGenerationMessage(t("generationLocatePending"));
      return;
    }

    const bounds = editor.getShapePageBounds(shapeId);
    editor.select(shapeId);
    if (bounds) {
      editor.zoomToBounds(bounds, {
        animation: { duration: 220 },
        inset: 96
      });
    } else {
      editor.zoomToSelection({ animation: { duration: 220 } });
    }
    setGenerationMessage(t("generationLocateSucceeded"));
  }

  async function rerunHistoryRecord(record: GenerationRecord): Promise<void> {
    const nextPresetId = coerceStylePresetId(record.presetId);
    const nextSizePresetId = sizePresetIdForSize(record.size.width, record.size.height);
    const nextCount = coerceGenerationCount(record.count);

    setPrompt(record.prompt);
    setStylePreset(nextPresetId);
    setSizePresetId(nextSizePresetId);
    setWidth(record.size.width);
    setHeight(record.size.height);
    setQuality(record.quality);
    setOutputFormat(record.outputFormat);
    setCount(nextCount);

    const referenceAssetIds = referenceAssetIdsForRecord(record);
    const nextGenerationMode: GenerationMode = referenceAssetIds.length > 0 ? "reference" : "text";
    setGenerationMode(nextGenerationMode);

    await executeGeneration(
      {
        prompt: record.prompt,
        presetId: nextPresetId,
        sizePresetId: nextSizePresetId,
        size: record.size,
        quality: record.quality,
        outputFormat: record.outputFormat,
        count: nextCount
      },
      nextGenerationMode,
      referenceAssetIds.length > 0
        ? async (_signal) => ({
            referenceAssetIds
          })
        : undefined,
      referenceAssetIds.length > 0 ? referenceAssetIds : undefined
    );
  }

  function downloadHistoryRecord(record: GenerationRecord): void {
    const asset = firstDownloadableAsset(record);
    setGenerationWarning("");
    if (!asset) {
      setGenerationError(t("generationDownloadNoAsset"));
      return;
    }

    window.open(assetDownloadUrl(asset.id), "_blank", "noopener,noreferrer");
    setGenerationMessage(t("generationDownloadOpened"));
  }

  function reuseGalleryImage(item: GalleryImageItem): void {
    const nextPresetId = coerceStylePresetId(item.presetId);
    const nextSizePresetId = sizePresetIdForSize(item.size.width, item.size.height);

    setPrompt(item.prompt);
    setStylePreset(nextPresetId);
    setSizePresetId(nextSizePresetId);
    setWidth(item.size.width);
    setHeight(item.size.height);
    setQuality(item.quality);
    setOutputFormat(item.outputFormat);
    setCount(1);
    setGenerationMode("text");
    setGenerationError("");
    setGenerationWarning("");
    setGenerationMessage(t("generationGalleryReused"));
    navigateToRoute("canvas");
    if (isMobileDrawer) {
      setIsAiPanelOpen(true);
    }
  }

  function removeGalleryOutputFromHistory(outputId: string): void {
    setGenerationHistory((history) =>
      history.flatMap((record) => {
        const nextOutputs = record.outputs.filter((output) => output.id !== outputId);
        if (nextOutputs.length === record.outputs.length) {
          return [record];
        }
        if (nextOutputs.length === 0) {
          return [];
        }
        return [
          {
            ...record,
            outputs: nextOutputs
          }
        ];
      })
    );
  }

  async function copyHistoryPrompt(record: GenerationRecord): Promise<void> {
    const promptText = record.prompt.trim();
    setGenerationError("");
    setGenerationMessage("");
    setGenerationWarning("");

    if (!promptText) {
      setGenerationError(t("generationMissingPromptHistory"));
      return;
    }

    try {
      await writeClipboardText(promptText);
      setGenerationMessage(t("generationCopiedPrompt"));
    } catch {
      setGenerationError(t("generationCopyFailed"));
    }
  }

  async function cancelGeneration(requestId: string): Promise<void> {
    const task = activeGenerationsRef.current.get(requestId);
    if (!task) {
      return;
    }

    setGenerationError("");
    setGenerationWarning("");

    try {
      const response = await apiFetch(`/api/generations/${encodeURIComponent(requestId)}/cancel`, {
        method: "POST"
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, locale, t));
      }

      const body = (await response.json()) as unknown;
      if (!isGenerationResponse(body)) {
        throw new Error(t("generationInvalidResponse"));
      }

      task.controller.abort();
      const editor = editorRef.current;
      if (editor) {
        markGenerationPlaceholdersFailed(editor, task.placeholderSet, body.record.error ?? t("generationUnknownCancel"));
        void saveProjectSnapshot(editor);
      }

      activeGenerationsRef.current.delete(requestId);
      setActiveGenerationCount(activeGenerationsRef.current.size);
      upsertGenerationHistoryRecord(body.record);
      setGenerationMessage(t("generationUnknownCancel"));
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : t("generationErrorDefault"));
    }
  }

  function ensureCurrentAgentConversationId(): string {
    const existingId = currentAgentConversationIdRef.current;
    if (existingId) {
      return existingId;
    }

    const conversationId = createAgentConversationId();
    currentAgentConversationIdRef.current = conversationId;
    setCurrentAgentConversationId(conversationId);
    return conversationId;
  }

  async function saveAgentConversationNow(conversationId: string, messages: AgentChatMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const requestId = agentHistorySaveRequestRef.current + 1;
    agentHistorySaveRequestRef.current = requestId;

    try {
      const response = await apiFetch(`/api/agent-conversations/${encodeURIComponent(conversationId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: agentConversationTitle(messages),
          messages: conversationMessagesFromAgentChat(messages)
        })
      });

      if (!response.ok) {
        throw new Error(`Agent conversation save failed with ${response.status}`);
      }

      if (isAgentHistoryOpen && agentHistorySaveRequestRef.current === requestId) {
        void loadAgentHistorySummaries();
      }
    } catch {
      if (isAgentHistoryOpen && agentHistorySaveRequestRef.current === requestId) {
        setAgentHistoryError(t("agentHistorySaveFailed"));
      }
    }
  }

  async function loadAgentHistorySummaries(signal?: AbortSignal): Promise<void> {
    setIsAgentHistoryLoading(true);
    setAgentHistoryError("");

    try {
      const response = await apiFetch("/api/agent-conversations", { signal });
      if (!response.ok) {
        throw new Error(`Agent history load failed with ${response.status}`);
      }

      const body = (await response.json()) as AgentConversationListResponse;
      const conversations = Array.isArray(body.conversations) ? body.conversations : [];
      setAgentHistorySummaries(conversations);
      if (conversations.length === 0) {
        setSelectedAgentHistoryId(null);
        setSelectedAgentConversation(null);
        return;
      }

      const selectedId = selectedAgentHistoryId && conversations.some((conversation) => conversation.id === selectedAgentHistoryId)
        ? selectedAgentHistoryId
        : conversations[0]?.id;
      if (selectedId) {
        setSelectedAgentHistoryId(selectedId);
        await loadAgentConversationDetail(selectedId, signal);
      }
    } catch {
      if (!signal?.aborted) {
        setAgentHistoryError(t("agentHistoryLoadFailed"));
      }
    } finally {
      if (!signal?.aborted) {
        setIsAgentHistoryLoading(false);
      }
    }
  }

  async function loadAgentConversationDetail(conversationId: string, signal?: AbortSignal): Promise<void> {
    setIsAgentHistoryDetailLoading(true);
    setAgentHistoryError("");

    try {
      const response = await apiFetch(`/api/agent-conversations/${encodeURIComponent(conversationId)}`, { signal });
      if (!response.ok) {
        throw new Error(`Agent conversation load failed with ${response.status}`);
      }

      setSelectedAgentConversation((await response.json()) as AgentConversation);
    } catch {
      if (!signal?.aborted) {
        setSelectedAgentConversation(null);
        setAgentHistoryError(t("agentHistoryDetailLoadFailed"));
      }
    } finally {
      if (!signal?.aborted) {
        setIsAgentHistoryDetailLoading(false);
      }
    }
  }

  function openAgentHistoryDialog(): void {
    setIsAgentHistoryOpen(true);
    if (currentAgentConversationId && agentMessages.length > 0) {
      void saveAgentConversationNow(currentAgentConversationId, agentMessages);
    }
    void loadAgentHistorySummaries();
  }

  function closeAgentHistoryDialog(): void {
    setIsAgentHistoryOpen(false);
  }

  function selectAgentHistoryConversation(conversationId: string): void {
    setSelectedAgentHistoryId(conversationId);
    void loadAgentConversationDetail(conversationId);
  }

  function resetAgentRuntimeForConversation(): void {
    const socket = agentSocketRef.current;
    stopAgentSocketHeartbeat(socket ?? undefined);
    resetAgentSocketReconnectState();
    activeAgentRunIdRef.current = null;
    agentConnectionIdRef.current = null;
    agentSocketRef.current = null;
    agentSocketOpenPromiseRef.current = null;

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.close(1000, "agent_conversation_reset");
    }

    pendingAgentSelectedReferencesRef.current.clear();
    agentPlanSelectedReferencesRef.current.clear();
    agentPlanCreatedRunIdsRef.current.clear();
    agentUserInputRunIdsRef.current.clear();
    agentOutputPlacementCountsRef.current.clear();
    deleteAgentJobLoadingPlaceholdersForRun();
    agentJobPlaceholdersRef.current.clear();
    clearCanvasAgentPlanNodes();
    setExpandedThinkingMessageIds([]);
    setCopiedAgentMessageId(null);
    setAgentInput("");
    setIsAgentSettingsOpen(false);
    setAgentRunStatus("idle");
  }

  function restoreAgentConversation(conversation: AgentConversation): void {
    if (isAgentRunning) {
      return;
    }

    resetAgentRuntimeForConversation();
    currentAgentConversationIdRef.current = conversation.id;
    setCurrentAgentConversationId(conversation.id);
    setAgentMessages(agentChatMessagesFromConversation(conversation.messages));
    setIsAgentHistoryOpen(false);
  }

  function addAgentMessage(message: Omit<AgentChatMessage, "id" | "timestamp">): void {
    setAgentMessages((messages) => [
      ...messages,
      {
        ...message,
        id: `agent-message-${crypto.randomUUID()}`,
        timestamp: new Date().toISOString()
      }
    ]);
  }

  async function copyAgentMessage(message: AgentChatMessage): Promise<void> {
    const text = (message.role === "thinking" ? message.details ?? message.content : message.content).trim();
    if (!text) {
      return;
    }

    try {
      await writeClipboardText(text);
      setCopiedAgentMessageId(message.id);
      if (agentCopyResetTimerRef.current !== undefined) {
        window.clearTimeout(agentCopyResetTimerRef.current);
      }
      agentCopyResetTimerRef.current = window.setTimeout(() => {
        setCopiedAgentMessageId((currentId) => (currentId === message.id ? null : currentId));
        agentCopyResetTimerRef.current = undefined;
      }, 1600);
    } catch {
      addAgentMessage({
        role: "error",
        content: t("agentCopyMessageFailed")
      });
    }
  }

  function toggleThinkingMessage(messageId: string): void {
    setExpandedThinkingMessageIds((currentIds) =>
      currentIds.includes(messageId) ? currentIds.filter((id) => id !== messageId) : [...currentIds, messageId]
    );
  }

  function isAgentStreamEventForActiveRun(event: Pick<AgentServerEvent, "runId">): boolean {
    const activeRunId = activeAgentRunIdRef.current;
    return Boolean(activeRunId && (!event.runId || event.runId === activeRunId));
  }

  function isStaleAgentRunEvent(event: Pick<AgentServerEvent, "runId">): boolean {
    const activeRunId = activeAgentRunIdRef.current;
    return Boolean(event.runId && (!activeRunId || event.runId !== activeRunId));
  }

  function runIdForAgentEvent(event: Pick<AgentServerEvent, "runId">): string | undefined {
    return event.runId ?? activeAgentRunIdRef.current ?? undefined;
  }

  function appendAgentStreamDelta(role: Extract<AgentChatMessageRole, "assistant" | "thinking">, delta: string, runId?: string): void {
    if (!delta) {
      return;
    }

    setAgentMessages((messages) => {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === role && !lastMessage.plan && lastMessage.runId === runId) {
        if (!lastMessage.content && !delta.trim()) {
          return messages;
        }

        return [
          ...messages.slice(0, -1),
          {
            ...lastMessage,
            content: `${lastMessage.content}${delta}`
          }
        ];
      }

      if (!delta.trim()) {
        return messages;
      }

      return [
        ...messages,
        {
          id: `agent-message-${crypto.randomUUID()}`,
          role,
          content: delta,
          timestamp: new Date().toISOString(),
          runId
        }
      ];
    });
  }

  function appendAgentAssistantDelta(delta: string, runId?: string): void {
    appendAgentStreamDelta("assistant", delta, runId);
  }

  function upsertAgentThinkingSummary(runId?: string): void {
    const content =
      locale === "zh-CN"
        ? "正在分析任务，整理生图计划与确认节点。"
        : "Reviewing the request and shaping a generation plan with confirmation steps.";
    setAgentMessages((messages) => {
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role !== "thinking" || message.plan || message.runId !== runId) {
          continue;
        }

        if (message.content === content) {
          return messages;
        }

        return messages.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                content
              }
            : item
        );
      }

      return [
        ...messages,
        {
          id: `agent-message-${crypto.randomUUID()}`,
          role: "thinking",
          content,
          timestamp: new Date().toISOString(),
          runId
        }
      ];
    });
  }

  function appendAgentThinkingDelta(delta: string, runId?: string): void {
    if (!delta.trim()) {
      return;
    }
    upsertAgentThinkingSummary(runId);
  }

  function appendAgentThinkingDetailsDelta(delta: string, runId?: string): void {
    if (!delta) {
      return;
    }

    const content = agentThinkingSummaryText(locale);
    setAgentMessages((messages) => {
      let existingIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role !== "thinking" || message.plan || message.runId !== runId) {
          continue;
        }

        existingIndex = index;
        break;
      }

      if (existingIndex >= 0) {
        return messages.map((message, index) =>
          index === existingIndex
            ? {
                ...message,
                content,
                details: `${message.details ?? ""}${delta}`
              }
            : message
        );
      }

      if (!delta.trim()) {
        return messages;
      }

      return [
        ...messages,
        {
          id: `agent-message-${crypto.randomUUID()}`,
          role: "thinking",
          content,
          details: delta,
          timestamp: new Date().toISOString(),
          runId
        }
      ];
    });
  }

  function upsertAgentPlanAttachment(
    plan: GenerationPlan,
    fallbackContent: string,
    runId?: string,
    selectedReferences?: AgentSelectedCanvasReference[]
  ): void {
    setAgentMessages((messages) => {
      let existingIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const existingPlan = messages[index]?.plan;
        if (isGenerationPlan(existingPlan) && existingPlan.id === plan.id) {
          existingIndex = index;
          break;
        }
      }
      if (existingIndex >= 0) {
        return messages.map((message, index) =>
          index === existingIndex
            ? {
                ...message,
                role: "plan",
                content: fallbackContent,
                plan,
                runId: message.runId ?? runId
              }
            : message
        );
      }

      return [
        ...messages,
        {
          id: `agent-message-${crypto.randomUUID()}`,
          role: "plan",
          content: fallbackContent,
          timestamp: new Date().toISOString(),
          runId,
          plan
        }
      ];
    });
  }

  function agentJobPlaceholderKey(planId: string, jobId: string): string {
    return `${planId}::${jobId}`;
  }

  function createAgentJobPlaceholderSet(editor: Editor, plan: GenerationPlan, job: GenerationJob, runId?: string): AgentJobPlaceholderSet | undefined {
    if (job.count <= 0) {
      return undefined;
    }

    const placementKey = plan.id;
    const placementIndex = agentOutputPlacementCountsRef.current.get(placementKey) ?? 0;
    agentOutputPlacementCountsRef.current.set(placementKey, placementIndex + job.count);
    agentPlaceholderRequestRef.current += 1;

    const targetSize = job.size ?? plan.defaults.size;
    const layout = agentPlanOutputLayout(plan);
    const placements = Array.from({ length: job.count }, (_, index) => agentOutputPlacementForSize(editor, targetSize, placementIndex + index, layout));
    const placeholderSet = createGenerationPlaceholdersFromPlacements(editor, placements, `agent-${agentPlaceholderRequestRef.current}`, {
      selectPlaceholders: false
    });
    const agentPlaceholderSet: AgentJobPlaceholderSet = {
      planId: plan.id,
      jobId: job.id,
      runId,
      placeholderSet,
      outputSlots: new Map()
    };

    agentJobPlaceholdersRef.current.set(agentJobPlaceholderKey(plan.id, job.id), agentPlaceholderSet);
    return agentPlaceholderSet;
  }

  function ensureAgentJobPlaceholders(plan: GenerationPlan, job: GenerationJob, runId?: string): void {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const key = agentJobPlaceholderKey(plan.id, job.id);
    const existingSet = agentJobPlaceholdersRef.current.get(key);
    if (existingSet && hasLoadingGenerationPlaceholders(editor, existingSet.placeholderSet)) {
      return;
    }

    createAgentJobPlaceholderSet(editor, plan, job, runId);
  }

  function nextLiveAgentPlaceholderIndex(editor: Editor, agentPlaceholderSet: AgentJobPlaceholderSet): number | undefined {
    for (let index = 0; index < agentPlaceholderSet.placeholderSet.placements.length; index += 1) {
      const placement = agentPlaceholderSet.placeholderSet.placements[index];
      if (placement && isGenerationPlaceholderShape(editor.getShape(placement.id))) {
        return index;
      }
    }

    return undefined;
  }

  function replaceAgentPlaceholderAtIndex(
    editor: Editor,
    agentPlaceholderSet: AgentJobPlaceholderSet,
    index: number,
    asset: GeneratedAsset,
    altText: string
  ): TLShapeId | undefined {
    const placement = agentPlaceholderSet.placeholderSet.placements[index];
    if (!placement || !isGenerationPlaceholderShape(editor.getShape(placement.id))) {
      return undefined;
    }

    const imageShape = createImageShape(asset, livePlacement(editor, placement), altText);
    const assetRecordId = createTldrawAssetId(asset.id);

    editor.run(() => {
      editor.deleteShapes([placement.id]);
      if (!editor.getAsset(assetRecordId)) {
        editor.createAssets([createImageAsset(asset)]);
      }
      editor.createShapes([imageShape]);
      editor.bringToFront([imageShape.id]);
    });

    return imageShape.id;
  }

  function replaceAgentPlaceholderWithAsset(event: Extract<AgentServerEvent, { type: "asset_preview" }>): TLShapeId | undefined {
    const editor = editorRef.current;
    if (!editor) {
      return undefined;
    }

    const key = agentJobPlaceholderKey(event.planId, event.jobId);
    const agentPlaceholderSet = agentJobPlaceholdersRef.current.get(key);
    if (!agentPlaceholderSet) {
      return undefined;
    }

    const existingSlot = agentPlaceholderSet.outputSlots.get(event.outputId);
    const outputIndex = existingSlot ?? nextLiveAgentPlaceholderIndex(editor, agentPlaceholderSet);
    if (outputIndex === undefined) {
      return undefined;
    }

    agentPlaceholderSet.outputSlots.set(event.outputId, outputIndex);
    return replaceAgentPlaceholderAtIndex(editor, agentPlaceholderSet, outputIndex, event.asset, `${event.jobId}: ${event.asset.fileName}`);
  }

  function finishAgentJobPlaceholdersFromOutputs(event: Extract<AgentServerEvent, { type: "job_completed" }>): void {
    const editor = editorRef.current;
    if (!editor || !event.outputs) {
      return;
    }

    const key = agentJobPlaceholderKey(event.planId, event.jobId);
    const agentPlaceholderSet = agentJobPlaceholdersRef.current.get(key);
    if (!agentPlaceholderSet) {
      return;
    }

    event.outputs.forEach((output, index) => {
      if (output.status !== "succeeded" || !output.asset) {
        return;
      }

      const outputIndex = agentPlaceholderSet.outputSlots.get(output.id) ?? index;
      replaceAgentPlaceholderAtIndex(editor, agentPlaceholderSet, outputIndex, output.asset, `${event.jobId}: ${output.asset.fileName}`);
    });
    deleteLoadingGenerationPlaceholders(editor, agentPlaceholderSet.placeholderSet);
    agentJobPlaceholdersRef.current.delete(key);
  }

  function markAgentJobPlaceholdersFailed(planId: string, jobId: string, error: string): void {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const key = agentJobPlaceholderKey(planId, jobId);
    const agentPlaceholderSet = agentJobPlaceholdersRef.current.get(key);
    if (!agentPlaceholderSet) {
      return;
    }

    markGenerationPlaceholdersFailed(editor, agentPlaceholderSet.placeholderSet, error);
    agentJobPlaceholdersRef.current.delete(key);
  }

  function deleteAgentJobLoadingPlaceholdersForRun(runId?: string): void {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    agentJobPlaceholdersRef.current.forEach((agentPlaceholderSet, key) => {
      if (runId && agentPlaceholderSet.runId !== runId) {
        return;
      }

      deleteLoadingGenerationPlaceholders(editor, agentPlaceholderSet.placeholderSet);
      agentJobPlaceholdersRef.current.delete(key);
    });
  }

  function syncAgentJobPlaceholdersForPlan(plan: GenerationPlan, runId?: string): void {
    plan.jobs.forEach((job) => {
      if (job.status === "running") {
        ensureAgentJobPlaceholders(plan, job, runId);
        return;
      }

      if (job.status === "failed") {
        markAgentJobPlaceholdersFailed(plan.id, job.id, job.error ?? t("generationErrorDefault"));
        return;
      }

      if (job.status === "blocked") {
        markAgentJobPlaceholdersFailed(plan.id, job.id, job.error ?? t("agentPlanJobStatusLabel", { status: job.status }));
        return;
      }

      if (job.status === "cancelled") {
        const editor = editorRef.current;
        const key = agentJobPlaceholderKey(plan.id, job.id);
        const agentPlaceholderSet = agentJobPlaceholdersRef.current.get(key);
        if (editor && agentPlaceholderSet) {
          deleteLoadingGenerationPlaceholders(editor, agentPlaceholderSet.placeholderSet);
          agentJobPlaceholdersRef.current.delete(key);
        }
      }
    });
  }

  function addAgentOutputAssetToCanvas(event: Extract<AgentServerEvent, { type: "asset_preview" }>): TLShapeId | undefined {
    const editor = editorRef.current;
    if (!editor) {
      return undefined;
    }

    const existingShapeId = findCanvasImageShapeByAssetId(editor, event.assetId, optionalShapeIdFromEvent(event));
    if (existingShapeId) {
      return existingShapeId;
    }

    const placeholderShapeId = replaceAgentPlaceholderWithAsset(event);
    if (placeholderShapeId) {
      return placeholderShapeId;
    }

    const placementKey = event.planId || event.runId || "agent";
    const placementIndex = agentOutputPlacementCountsRef.current.get(placementKey) ?? 0;
    agentOutputPlacementCountsRef.current.set(placementKey, placementIndex + 1);

    const imageShape = createImageShape(
      event.asset,
      agentOutputPlacement(editor, event.planId, event.asset, placementIndex),
      `${event.jobId}: ${event.asset.fileName}`
    );
    const assetRecordId = createTldrawAssetId(event.asset.id);

    editor.run(() => {
      if (!editor.getAsset(assetRecordId)) {
        editor.createAssets([createImageAsset(event.asset)]);
      }
      editor.createShapes([imageShape]);
      editor.bringToFront([imageShape.id]);
    });

    return imageShape.id;
  }

  function addAgentAssetPreview(event: Extract<AgentServerEvent, { type: "asset_preview" }>): void {
    const shapeId = addAgentOutputAssetToCanvas(event);
    const preview: AgentChatAssetPreview = {
      id: `agent-preview-${event.jobId}-${event.assetId}-${crypto.randomUUID()}`,
      assetId: event.assetId,
      jobId: event.jobId,
      outputId: event.outputId,
      planId: event.planId,
      shapeId,
      url: normalizeAssetUrl(event.url)
    };

    setAgentMessages((messages) => {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role === "assistant" && lastMessage.previews && lastMessage.runId === event.runId) {
        return [
          ...messages.slice(0, -1),
          {
            ...lastMessage,
            previews: [...lastMessage.previews, preview]
          }
        ];
      }

      return [
        ...messages,
        {
          id: `agent-message-${crypto.randomUUID()}`,
          role: "assistant",
          content: t("agentPreviewReady"),
          timestamp: new Date().toISOString(),
          runId: event.runId,
          previews: [preview]
        }
      ];
    });
  }

  function clearCanvasAgentPlanNodes(planId?: string): void {
    const editor = editorRef.current;
    if (planId) {
      agentOutputPlacementCountsRef.current.delete(planId);
    }
    if (editor) {
      deleteAgentPlanNodes(editor);
    }
  }

  function agentContextIndexesLabel(indexes: number[]): string {
    if (indexes.length === 0) {
      return "";
    }

    const isConsecutive = indexes.every((index, itemIndex) => itemIndex === 0 || index === indexes[itemIndex - 1] + 1);
    if (isConsecutive && indexes.length > 4) {
      return `${indexes[0]}-${indexes[indexes.length - 1]}`;
    }

    return indexes.length <= 4 ? indexes.join(", ") : `${indexes.slice(0, 4).join(", ")}...`;
  }

  function handleAgentServerEvent(event: AgentServerEvent): void {
    switch (event.type) {
      case "context_resolved":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        addAgentMessage({
          role: "system",
          content: t("agentContextResolvedPreviousOutputs", {
            count: event.referenceCount,
            indexes: agentContextIndexesLabel(event.referenceIndexes)
          }),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "assistant_delta":
        if (!isAgentStreamEventForActiveRun(event)) {
          return;
        }
        appendAgentAssistantDelta(event.delta, runIdForAgentEvent(event));
        return;
      case "assistant_thinking_delta":
        if (!isAgentStreamEventForActiveRun(event)) {
          return;
        }
        appendAgentThinkingDetailsDelta(event.delta, runIdForAgentEvent(event));
        return;
      case "plan_created":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (!isGenerationPlan(event.plan)) {
          addAgentMessage({
            role: "error",
            content: t("agentInvalidEvent"),
            runId: runIdForAgentEvent(event)
          });
          return;
        }
        {
          const eventRunId = runIdForAgentEvent(event);
          if (eventRunId) {
            agentPlanCreatedRunIdsRef.current.add(eventRunId);
          }
          const selectedReferences = event.runId ? pendingAgentSelectedReferencesRef.current.get(event.runId) : undefined;
          if (event.runId) {
            pendingAgentSelectedReferencesRef.current.delete(event.runId);
          }
          if (selectedReferences) {
            agentPlanSelectedReferencesRef.current.set(event.plan.id, selectedReferences);
          }
          clearCanvasAgentPlanNodes(event.plan.id);
          upsertAgentPlanAttachment(
            event.plan,
            t("agentPlanCreated", { title: event.plan.title }),
            eventRunId,
            selectedReferences ?? agentPlanSelectedReferencesRef.current.get(event.plan.id)
          );
        }
        return;
      case "plan_updated":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (!isGenerationPlan(event.plan)) {
          addAgentMessage({
            role: "error",
            content: t("agentInvalidEvent"),
            runId: runIdForAgentEvent(event)
          });
          return;
        }
        clearCanvasAgentPlanNodes();
        syncAgentJobPlaceholdersForPlan(event.plan, runIdForAgentEvent(event));
        upsertAgentPlanAttachment(
          event.plan,
          t("agentPlanUpdated", { title: event.plan.title }),
          runIdForAgentEvent(event),
          agentPlanSelectedReferencesRef.current.get(event.plan.id)
        );
        return;
      case "asset_preview":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        addAgentAssetPreview(event);
        return;
      case "job_started":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        addAgentMessage({
          role: "system",
          content: t("agentJobStarted", { jobId: event.jobId }),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "job_completed":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (event.record) {
          setGenerationHistory((history) =>
            [event.record as GenerationRecord, ...history.filter((record) => record.id !== event.record?.id)].slice(0, 20)
          );
        }
        finishAgentJobPlaceholdersFromOutputs(event);
        addAgentMessage({
          role: "system",
          content: t("agentJobCompleted", { jobId: event.jobId }),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "job_failed":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        markAgentJobPlaceholdersFailed(event.planId, event.jobId, event.error);
        addAgentMessage({
          role: "error",
          content: t("agentJobFailed", { jobId: event.jobId, error: event.error }),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "job_blocked":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        markAgentJobPlaceholdersFailed(event.planId, event.jobId, event.reason);
        addAgentMessage({
          role: "error",
          content: t("agentJobBlocked", { jobId: event.jobId, reason: event.reason }),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "error":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (event.runId) {
          pendingAgentSelectedReferencesRef.current.delete(event.runId);
        }
        {
          const eventRunId = runIdForAgentEvent(event);
          const shouldAskUser = event.recoverable && isAgentUserInputErrorCode(event.code);
          if (shouldAskUser && eventRunId) {
            agentUserInputRunIdsRef.current.add(eventRunId);
          }
          addAgentMessage({
            role: shouldAskUser ? "question" : "error",
            content: shouldAskUser
              ? event.message
              : localizedApiErrorMessage({
                  code: event.code,
                  fallbackMessage: event.message,
                  fallbackText: event.message,
                  locale,
                  status: 400
                }),
            runId: eventRunId
          });
        }
        deleteAgentJobLoadingPlaceholdersForRun(event.runId);
        if (event.runId && activeAgentRunIdRef.current === event.runId) {
          activeAgentRunIdRef.current = null;
          setAgentRunStatus("idle");
          resetAgentSocketReconnectState();
        }
        return;
      case "run_cancelled":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (event.runId) {
          pendingAgentSelectedReferencesRef.current.delete(event.runId);
        }
        activeAgentRunIdRef.current = null;
        setAgentRunStatus("idle");
        resetAgentSocketReconnectState();
        deleteAgentJobLoadingPlaceholdersForRun(event.runId);
        addAgentMessage({
          role: "system",
          content: event.alreadyCancelled ? t("agentRunAlreadyCancelled") : t("agentRunCancelled"),
          runId: runIdForAgentEvent(event)
        });
        return;
      case "run_done":
        if (isStaleAgentRunEvent(event)) {
          return;
        }
        if (event.runId) {
          pendingAgentSelectedReferencesRef.current.delete(event.runId);
        }
        if (!event.runId || activeAgentRunIdRef.current === event.runId) {
          activeAgentRunIdRef.current = null;
          setAgentRunStatus("idle");
          resetAgentSocketReconnectState();
        }
        if (event.status === "cancelled") {
          deleteAgentJobLoadingPlaceholdersForRun(event.runId);
        }
        {
          const eventRunId = runIdForAgentEvent(event);
          if (event.status === "succeeded" && eventRunId && agentPlanCreatedRunIdsRef.current.delete(eventRunId)) {
            return;
          }
          if (event.status === "failed" && eventRunId && agentUserInputRunIdsRef.current.delete(eventRunId)) {
            return;
          }
          addAgentMessage({
            role: event.status === "succeeded" ? "system" : "error",
            content: t("agentRunDone", { status: event.status }),
            runId: eventRunId
          });
        }
        return;
      case "connected":
        agentConnectionIdRef.current = event.connectionId;
        return;
      case "pong":
      default:
        return;
    }
  }

  function clearAgentSocketReconnectTimer(): void {
    window.clearTimeout(agentSocketReconnectTimerRef.current);
    agentSocketReconnectTimerRef.current = undefined;
  }

  function resetAgentSocketReconnectState(): void {
    clearAgentSocketReconnectTimer();
    agentSocketReconnectDeadlineRef.current = undefined;
    agentSocketReconnectDelayRef.current = AGENT_SOCKET_RECONNECT_INITIAL_MS;
  }

  function failAgentSocketReconnect(runId: string): void {
    if (activeAgentRunIdRef.current !== runId) {
      return;
    }

    activeAgentRunIdRef.current = null;
    setAgentRunStatus("idle");
    stopAgentSocketHeartbeat();
    resetAgentSocketReconnectState();
    deleteAgentJobLoadingPlaceholdersForRun(runId);
    addAgentMessage({
      role: "error",
      content: t("agentSocketClosed"),
      runId
    });
  }

  function scheduleAgentSocketReconnect(runId: string): void {
    clearAgentSocketReconnectTimer();
    if (activeAgentRunIdRef.current !== runId) {
      return;
    }

    const now = Date.now();
    const deadline = agentSocketReconnectDeadlineRef.current ?? now + AGENT_SOCKET_RECONNECT_WINDOW_MS;
    agentSocketReconnectDeadlineRef.current = deadline;
    const remainingMs = deadline - now;
    if (remainingMs <= 0) {
      failAgentSocketReconnect(runId);
      return;
    }

    setAgentRunStatus("connecting");
    const delayMs = Math.min(agentSocketReconnectDelayRef.current, remainingMs);
    agentSocketReconnectTimerRef.current = window.setTimeout(() => {
      agentSocketReconnectTimerRef.current = undefined;
      if (activeAgentRunIdRef.current !== runId) {
        return;
      }

      void ensureAgentSocket()
        .then(() => {
          if (activeAgentRunIdRef.current === runId) {
            setAgentRunStatus("running");
          }
        })
        .catch(() => {
          if (activeAgentRunIdRef.current !== runId) {
            return;
          }
          agentSocketReconnectDelayRef.current = Math.min(agentSocketReconnectDelayRef.current * 2, AGENT_SOCKET_RECONNECT_MAX_MS);
          scheduleAgentSocketReconnect(runId);
        });
    }, delayMs);
  }

  function ensureAgentSocket(): Promise<WebSocket> {
    const existingSocket = agentSocketRef.current;
    if (existingSocket?.readyState === WebSocket.OPEN) {
      startAgentSocketHeartbeat(existingSocket);
      return Promise.resolve(existingSocket);
    }
    if (existingSocket?.readyState === WebSocket.CONNECTING && agentSocketOpenPromiseRef.current) {
      return agentSocketOpenPromiseRef.current;
    }

    setAgentRunStatus("connecting");
    const socket = new WebSocket(
      agentWebSocketUrl(agentConnectionIdRef.current, activeAgentRunIdRef.current, currentAgentConversationIdRef.current)
    );
    agentSocketRef.current = socket;

    const openPromise = new Promise<WebSocket>((resolve, reject) => {
      let settled = false;

      socket.onopen = () => {
        resetAgentSocketReconnectState();
        startAgentSocketHeartbeat(socket);
        settled = true;
        resolve(socket);
      };
      socket.onmessage = (messageEvent) => {
        const event = parseAgentServerEvent(messageEvent.data);
        if (!event) {
          addAgentMessage({
            role: "error",
            content: t("agentInvalidEvent")
          });
          return;
        }

        handleAgentServerEvent(event);
      };
      socket.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error(t("agentSocketFailed")));
        } else if (!activeAgentRunIdRef.current) {
          addAgentMessage({
            role: "error",
            content: t("agentSocketFailed")
          });
        }
      };
      socket.onclose = () => {
        const isCurrentSocket = agentSocketRef.current === socket;
        if (isCurrentSocket) {
          agentSocketRef.current = null;
          agentSocketOpenPromiseRef.current = null;
        }
        stopAgentSocketHeartbeat(socket);
        if (!isCurrentSocket) {
          return;
        }
        if (!settled) {
          settled = true;
          reject(new Error(t("agentSocketFailed")));
          return;
        }
        const activeRunId = activeAgentRunIdRef.current;
        if (activeRunId) {
          scheduleAgentSocketReconnect(activeRunId);
        }
      };
    });

    agentSocketOpenPromiseRef.current = openPromise;
    return openPromise;
  }

  function startAgentSocketHeartbeat(socket: WebSocket): void {
    stopAgentSocketHeartbeat();
    agentSocketPingTimerRef.current = window.setInterval(() => {
      if (agentSocketRef.current !== socket || socket.readyState !== WebSocket.OPEN) {
        stopAgentSocketHeartbeat(socket);
        return;
      }

      const runId = activeAgentRunIdRef.current;
      const pingMessage: { type: "ping"; requestId: string; runId?: string } = {
        type: "ping",
        requestId: `agent-heartbeat-${runId ?? "idle"}-${Date.now()}`
      };
      if (runId) {
        pingMessage.runId = runId;
      }

      // Keep the Agent channel warm even when the browser throttles inactive UI work.
      socket.send(JSON.stringify(pingMessage));
    }, AGENT_SOCKET_PING_INTERVAL_MS);
  }

  function stopAgentSocketHeartbeat(socket?: WebSocket): void {
    if (socket && agentSocketRef.current && agentSocketRef.current !== socket) {
      return;
    }

    window.clearInterval(agentSocketPingTimerRef.current);
    agentSocketPingTimerRef.current = undefined;
  }

  function startNewAgentConversation(): void {
    if (isAgentRunning) {
      return;
    }

    if (currentAgentConversationId && agentMessages.length > 0) {
      void saveAgentConversationNow(currentAgentConversationId, agentMessages);
    }

    resetAgentRuntimeForConversation();
    const nextConversationId = createAgentConversationId();
    currentAgentConversationIdRef.current = nextConversationId;
    setCurrentAgentConversationId(nextConversationId);
    setAgentMessages([]);
  }

  function selectAgentSizePreset(nextPresetId: string): void {
    if (nextPresetId === CUSTOM_SIZE_PRESET_ID) {
      setAgentSizePresetId(CUSTOM_SIZE_PRESET_ID);
      return;
    }

    const preset = SIZE_PRESETS.find((item) => item.id === nextPresetId);
    if (!preset) {
      return;
    }

    setAgentSizePresetId(preset.id);
    setAgentWidth(preset.width);
    setAgentHeight(preset.height);
  }

  function updateAgentWidth(value: string): void {
    setAgentWidth(normalizeDimension(value));
    setAgentSizePresetId(CUSTOM_SIZE_PRESET_ID);
  }

  function updateAgentHeight(value: string): void {
    setAgentHeight(normalizeDimension(value));
    setAgentSizePresetId(CUSTOM_SIZE_PRESET_ID);
  }

  async function submitAgentMessage(): Promise<void> {
    if (!trimmedAgentInput || isAgentRunning) {
      return;
    }

    if (!isAgentConfigured) {
      addAgentMessage({
        role: "error",
        content: t("agentConfigMissingCopy")
      });
      return;
    }

    if (agentDefaultsValidationMessage) {
      addAgentMessage({
        role: "error",
        content: agentDefaultsValidationMessage
      });
      return;
    }

    const requestId = `agent-request-${agentRequestRef.current + 1}`;
    const runId = `agent-run-${crypto.randomUUID()}`;
    agentRequestRef.current += 1;
    ensureCurrentAgentConversationId();
    activeAgentRunIdRef.current = runId;
    setAgentInput("");
    setIsAgentSettingsOpen(false);
    addAgentMessage({
      role: "user",
      content: trimmedAgentInput,
      runId
    });

    try {
      let selectedReferences: AgentSelectedCanvasReference[] = [];
      if (agentReferenceSelection.references.length > 0) {
        selectedReferences = await buildAgentSelectedReferences({
          references: agentReferenceSelection.references,
          t
        });
      }

      pendingAgentSelectedReferencesRef.current.set(runId, selectedReferences);
      const socket = await ensureAgentSocket();
      socket.send(
        JSON.stringify({
          type: "user_message",
          requestId,
          runId,
          text: trimmedAgentInput,
          defaults: agentDefaults,
          plannerOptions: supportsAgentThinkingControls ? agentPlannerOptions : undefined,
          selectedReferences,
          selectedReferenceIds: selectedReferences.map((reference) => reference.assetId)
        })
      );
      setAgentRunStatus("running");
    } catch (error) {
      pendingAgentSelectedReferencesRef.current.delete(runId);
      activeAgentRunIdRef.current = null;
      setAgentRunStatus("idle");
      stopAgentSocketHeartbeat();
      resetAgentSocketReconnectState();
      addAgentMessage({
        role: "error",
        content: error instanceof Error ? error.message : t("agentSendFailed")
      });
    }
  }

  function cancelAgentRun(): void {
    const runId = activeAgentRunIdRef.current;
    const socket = agentSocketRef.current;
    if (!runId || !socket || socket.readyState !== WebSocket.OPEN) {
      activeAgentRunIdRef.current = null;
      setAgentRunStatus("idle");
      stopAgentSocketHeartbeat();
      resetAgentSocketReconnectState();
      addAgentMessage({
        role: "system",
        content: t("agentRunCancelled")
      });
      return;
    }

    socket.send(
      JSON.stringify({
        type: "cancel_run",
        requestId: `agent-cancel-${crypto.randomUUID()}`,
        runId
      })
    );
  }

  async function sendAgentPlanAction(plan: GenerationPlan, action: AgentPlanAction): Promise<void> {
    if (action === "cancel") {
      try {
        const runId = activeAgentRunIdRef.current || undefined;
        const socket = agentSocketRef.current?.readyState === WebSocket.OPEN ? agentSocketRef.current : await ensureAgentSocket();
        socket.send(
          JSON.stringify({
            type: "cancel_run",
            requestId: `agent-plan-cancel-${crypto.randomUUID()}`,
            runId
          })
        );
      } catch (error) {
        addAgentMessage({
          role: "error",
          content: error instanceof Error ? error.message : t("agentSocketFailed")
        });
      }
      return;
    }

    if (isAgentRunning) {
      addAgentMessage({
        role: "error",
        content: t("agentPlanActionBusy")
      });
      return;
    }

    if (!isAgentConfigured) {
      addAgentMessage({
        role: "error",
        content: t("agentConfigMissingCopy")
      });
      return;
    }

    const runId = `agent-plan-run-${crypto.randomUUID()}`;
    ensureCurrentAgentConversationId();
    activeAgentRunIdRef.current = runId;
    setAgentRunStatus("connecting");

    try {
      let selectedReferences = agentPlanSelectedReferencesRef.current.get(plan.id);
      if (!selectedReferences && agentReferenceSelection.references.length > 0) {
        selectedReferences = await buildAgentSelectedReferences({
          references: agentReferenceSelection.references,
          t
        });
      }
      const socket = await ensureAgentSocket();
      clearCanvasAgentPlanNodes();
      if (selectedReferences) {
        agentPlanSelectedReferencesRef.current.set(plan.id, selectedReferences);
      }
      socket.send(
        JSON.stringify({
          type: action === "execute" ? "execute_plan" : "retry_failed",
          requestId: `agent-plan-action-${crypto.randomUUID()}`,
          runId,
          planId: plan.id,
          plan,
          selectedReferences
        })
      );
      setAgentRunStatus("running");
    } catch (error) {
      if (activeAgentRunIdRef.current === runId) {
        activeAgentRunIdRef.current = null;
      }
      setAgentRunStatus("idle");
      stopAgentSocketHeartbeat();
      resetAgentSocketReconnectState();
      addAgentMessage({
        role: "error",
        content: error instanceof Error ? error.message : t("agentSendFailed")
      });
    }
  }

  function locateAgentPreview(preview: AgentChatAssetPreview): void {
    const editor = editorRef.current;
    if (!editor) {
      addAgentMessage({
        role: "error",
        content: t("generationCanvasNotReady")
      });
      return;
    }

    const shapeId = findCanvasImageShapeByAssetId(editor, preview.assetId, preview.shapeId);
    if (!shapeId) {
      addAgentMessage({
        role: "system",
        content: t("agentPreviewShapePending")
      });
      return;
    }

    const bounds = editor.getShapePageBounds(shapeId);
    editor.select(shapeId);
    if (bounds) {
      editor.zoomToBounds(bounds, {
        animation: { duration: 220 },
        inset: 96
      });
    } else {
      editor.zoomToSelection({ animation: { duration: 220 } });
    }
  }

  return (
    <div
      className="app-root"
      data-canvas-theme={route !== "home" && isCanvasDarkMode ? "dark" : "light"}
      data-region-annotation-mode={isReferenceMode ? regionAnnotationMode : undefined}
      data-region-modifier-active={
        isRegionAnnotationActive && panelTab === "manual" && isRegionModifierPressed ? "true" : undefined
      }
    >
      <TopNavigation
        isAiCoveMode={isAiCoveMode}
        route={route}
        onNavigate={navigateToRoute}
        onOpenProviderConfig={() => openProviderConfigDialog()}
        onPreloadGallery={preloadGalleryPage}
      />
      {route === "home" ? (
        <Suspense fallback={null}>
          <LazyHomePage
            authError={authError}
            authStatus={authStatus}
            isAuthLoading={isAuthLoading}
            isCodexStarting={codexLoginStatus === "starting"}
            onOpenProviderConfig={() => openProviderConfigDialog()}
            onOpenGallery={() => navigateToRoute("gallery")}
            onStartCodexLogin={startCodexLogin}
          />
        </Suspense>
      ) : null}
      <main className="app-shell app-view relative flex min-h-0 overflow-hidden bg-neutral-950 text-neutral-900" data-active-route={route} hidden={route !== "canvas"}>
      <section
        className="relative min-w-0 flex-1 bg-neutral-100 outline-none"
        aria-label={t("appCanvasAria")}
        data-testid="canvas-shell"
        ref={canvasShellRef}
        tabIndex={-1}
      >
        {isHostSessionBlocked ? (
          <div className="canvas-loading-state canvas-host-session-state" role="alert">
            <AlertTriangle className="size-5 text-amber-600" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-800">{t("hostSessionRequired")}</p>
              <p className="mt-1 text-xs text-neutral-500">{hostSessionError}</p>
            </div>
          </div>
        ) : isProjectLoaded ? (
          <Tldraw
            assets={canvasAssetStore}
            components={tldrawComponents}
            licenseKey={TLDRAW_LICENSE_KEY}
            options={tldrawOptions}
            snapshot={projectSnapshot}
            shapeUtils={shapeUtils}
            user={tldrawUser}
            onMount={handleEditorMount}
          />
        ) : (
          <div className="canvas-loading-state">
            <BrandMark className="brand-mark--large" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-neutral-800">{t("canvasLoadingTitle")}</p>
              <p className="mt-1 text-xs text-neutral-500">{t("appTagline")}</p>
            </div>
          </div>
        )}
      </section>

      {isMobileDrawer && isAiPanelOpen ? (
        <button
          aria-label={t("generationPanelClose")}
          className="ai-panel-backdrop"
          data-testid="ai-panel-backdrop"
          type="button"
          onClick={closeAiPanel}
        />
      ) : null}

      <button
        aria-controls="ai-panel"
        aria-expanded={isAiPanelOpen}
        aria-haspopup="dialog"
        className="mobile-ai-trigger"
        data-drawer-state={isAiPanelOpen ? "open" : "closed"}
        data-testid="open-ai-panel"
        type="button"
        onClick={() => setIsAiPanelOpen(true)}
      >
        <Sparkles className="size-4" aria-hidden="true" />
        {t("generationStartText")}
      </button>

      <aside
        aria-label={t("generationPanelAria")}
        aria-modal={isMobileDrawer && isAiPanelOpen ? true : undefined}
        className="ai-panel fixed inset-y-0 right-0 z-20 flex flex-col border-l border-neutral-200 bg-white shadow-2xl shadow-neutral-950/15"
        data-drawer-state={isAiPanelOpen ? "open" : "closed"}
        data-testid="ai-panel"
        id="ai-panel"
        role={isMobileDrawer ? "dialog" : "complementary"}
        {...(isMobileDrawer && !isAiPanelOpen ? { inert: "" } : {})}
      >
        <div className="border-b border-neutral-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="brand-lockup">
              <BrandMark />
              <div className="min-w-0">
                <BrandName />
                <p className="brand-tagline">{t("appTagline")}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ProviderStatusPopover
                authError={authError}
                authStatus={authStatus}
                codexLoginStatus={codexLoginStatus}
                isAuthLoading={isAuthLoading}
                onLogoutCodex={logoutCodexSession}
                onStartCodexLogin={startCodexLogin}
              />
              <button
                aria-label={t("storageSettings")}
                className={`inline-flex h-7 w-7 items-center justify-center rounded-md border text-xs transition focus:outline-none focus:ring-2 focus:ring-cyan-100 ${
                  storageConfig?.enabled
                    ? "border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
                    : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
                }`}
                data-testid="storage-settings-button"
                title={storageConfig?.enabled ? t("storageEnabledTitle") : t("storageSettings")}
                type="button"
                onClick={openStorageDialog}
              >
                <Cloud className="size-4" aria-hidden="true" />
              </button>
              <div
                className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium ${
                  saveStatus === "error" ? "bg-red-50 text-red-700" : "bg-neutral-100 text-neutral-600"
                }`}
                data-testid="save-status"
                role="status"
              >
                <SaveStatusIcon status={saveStatus} />
                {saveStatusLabel(saveStatus, t)}
              </div>
              <button
                aria-label={t("generationPanelClose")}
                className="ai-panel-close"
                ref={panelCloseButtonRef}
                type="button"
                onClick={closeAiPanel}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div
          className="panel-tab-switcher"
          data-active-tab={panelTab}
          data-testid="right-panel-tab-switcher"
          role="tablist"
          aria-label={t("panelTabAria")}
        >
          <button
            aria-selected={panelTab === "manual"}
            className={panelTab === "manual" ? "panel-tab-switcher__button is-active" : "panel-tab-switcher__button"}
            data-testid="panel-tab-manual"
            role="tab"
            type="button"
            onClick={() => setPanelTab("manual")}
          >
            {t("panelTabManual")}
          </button>
          <button
            aria-selected={panelTab === "agent"}
            className={panelTab === "agent" ? "panel-tab-switcher__button is-active" : "panel-tab-switcher__button"}
            data-testid="panel-tab-agent"
            role="tab"
            type="button"
            onClick={() => setPanelTab("agent")}
          >
            <Bot className="size-3.5" aria-hidden="true" />
            {t("panelTabAgent")}
          </button>
        </div>

        {panelTab === "manual" ? (
        <>
        <div className="ai-panel-body ai-panel-tab-panel ai-panel-tab-panel--body flex-1 space-y-5 overflow-y-auto px-5 py-5" data-tab="manual">
          {saveError ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="save-error">
              {saveError}
            </p>
          ) : null}

          <div data-testid="generation-mode-control">
            <span className="control-label">{t("generationModeLabel")}</span>
            <div className="mt-2 grid grid-cols-2 gap-2" role="group" aria-label={t("generationModeAria")}>
              <button
                className={generationMode === "text" ? "segmented-control h-9 text-xs is-active" : "segmented-control h-9 text-xs"}
                type="button"
                aria-pressed={generationMode === "text"}
                data-testid="mode-text"
                onClick={() => setGenerationMode("text")}
              >
                {t("modeLabel", { mode: "generate" })}
              </button>
              <button
                className={
                  generationMode === "reference" ? "segmented-control h-9 text-xs is-active" : "segmented-control h-9 text-xs"
                }
                type="button"
                aria-pressed={generationMode === "reference"}
                data-testid="mode-reference"
                onClick={() => setGenerationMode("reference")}
              >
                {t("modeLabel", { mode: "edit" })}
              </button>
            </div>
          </div>

          <div className="prompt-workflow">
            <div className="prompt-workflow__head">
              <div className="prompt-workflow__label-row">
                <label className="control-label" htmlFor="prompt-input">
                  {t("generationPromptLabel")}
                </label>
              </div>
              {isReferenceMode ? (
                <div className="region-annotation-switch" role="group" aria-label={t("regionPromptModeAria")}>
                  <button
                    className={regionAnnotationMode === "none" ? "region-annotation-switch__button is-active" : "region-annotation-switch__button"}
                    type="button"
                    aria-pressed={regionAnnotationMode === "none"}
                    data-testid="region-mode-none"
                    onClick={() => selectRegionAnnotationMode("none")}
                  >
                    <ImageIcon className="size-3.5" aria-hidden="true" />
                    {t("regionPromptNoneMode")}
                  </button>
                  <button
                    className={regionAnnotationMode === "auto" ? "region-annotation-switch__button is-active" : "region-annotation-switch__button"}
                    type="button"
                    aria-pressed={regionAnnotationMode === "auto"}
                    data-testid="region-mode-auto"
                    onClick={() => selectRegionAnnotationMode("auto")}
                  >
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    {t("regionPromptAutoMode")}
                  </button>
                  <button
                    className={regionAnnotationMode === "manual" ? "region-annotation-switch__button is-active" : "region-annotation-switch__button"}
                    type="button"
                    aria-pressed={regionAnnotationMode === "manual"}
                    data-testid="region-mode-manual"
                    onClick={() => selectRegionAnnotationMode("manual")}
                  >
                    <MapPin className="size-3.5" aria-hidden="true" />
                    {t("regionPromptManualMode")}
                  </button>
                </div>
              ) : null}
            </div>
            {isReferenceMode ? (
              <p className="prompt-workflow__status">
                <span>{regionAnnotationModeHint}</span>
                <span>{regionAnnotationStatus}</span>
              </p>
            ) : null}
            {isRegionAnnotationActive ? (
              <div className="prompt-preview-tabs" role="tablist" aria-label={t("promptPreviewTabsAria")}>
                <button
                  className={promptPreviewTab === "edit" ? "prompt-preview-tabs__button is-active" : "prompt-preview-tabs__button"}
                  type="button"
                  role="tab"
                  aria-selected={promptPreviewTab === "edit"}
                  onClick={() => setPromptPreviewTab("edit")}
                >
                  {t("promptEditTab")}
                </button>
                <button
                  className={promptPreviewTab === "final" ? "prompt-preview-tabs__button is-active" : "prompt-preview-tabs__button"}
                  type="button"
                  role="tab"
                  aria-selected={promptPreviewTab === "final"}
                  onClick={() => setPromptPreviewTab("final")}
                >
                  {t("promptFinalTab")}
                </button>
              </div>
            ) : null}
            <div
              className="prompt-composer"
              data-prompt-view={isRegionAnnotationActive ? promptPreviewTab : "edit"}
              data-has-tags={isRegionAnnotationActive && regionPromptItems.length > 0 ? "true" : undefined}
              data-region-mode={isReferenceMode ? regionAnnotationMode : undefined}
            >
              {isRegionAnnotationActive && promptPreviewTab === "final" ? (
                <pre className="prompt-final-preview-panel" tabIndex={0} aria-label={t("promptFinalTab")} data-testid="prompt-final-preview">
                  {finalPromptPreviewTitle}
                </pre>
              ) : isRegionAnnotationActive ? (
                <Suspense
                  fallback={
                    <textarea
                      aria-busy="true"
                      aria-invalid={Boolean(promptValidationMessage)}
                      aria-label={t("generationPromptLabel")}
                      className="prompt-textarea prompt-textarea--embedded prompt-region-editor-fallback w-full resize-none"
                      data-testid="prompt-input"
                      id="prompt-input"
                      name="prompt"
                      placeholder={t("generationPromptPlaceholder")}
                      readOnly
                      rows={4}
                      value={prompt}
                    />
                  }
                >
                  <LazyPromptRegionEditor
                    ariaInvalid={Boolean(promptValidationMessage)}
                    ariaLabel={t("generationPromptLabel")}
                    arrivingIds={arrivingRegionPromptIds}
                    id="prompt-input"
                    isEmpty={isPromptEditorEmpty}
                    onChange={handlePromptEditorChange}
                    onCursorChange={(cursorIndex) => {
                      promptEditorCursorIndexRef.current = cursorIndex;
                    }}
                    onHideRegionPreview={handleHideRegionFocusPreview}
                    onShowRegionPreview={handleShowRegionFocusPreview}
                    placeholder={t("generationPromptPlaceholder")}
                    locale={locale}
                    ref={setPromptRegionEditorHandle}
                    regions={regionPromptItems}
                    t={t}
                    testId="prompt-input"
                    value={prompt}
                  />
                </Suspense>
              ) : (
                <textarea
                  aria-invalid={Boolean(promptValidationMessage)}
                  className="prompt-textarea prompt-textarea--embedded w-full resize-none rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm leading-6 text-neutral-950 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  id="prompt-input"
                  name="prompt"
                  placeholder={t("generationPromptPlaceholder")}
                  ref={promptInputRef}
                  rows={4}
                  value={prompt}
                  data-testid="prompt-input"
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    window.requestAnimationFrame(resizePromptInput);
                  }}
                />
              )}
            </div>
          </div>

          {!submittedPromptPreview.trim() ? (
            <div className="-mt-3 flex flex-wrap gap-2" data-testid="prompt-starters">
              {promptStarters.map((starter) => (
                <button
                  className="prompt-chip"
                  key={starter.labelKey}
                  type="button"
                  title={t(starter.promptKey)}
                  data-testid="prompt-starter-chip"
                  onClick={() => applyPromptStarter(t(starter.promptKey))}
                >
                  {t(starter.labelKey)}
                </button>
              ))}
            </div>
          ) : null}

          {isReferenceMode ? (
            <section
              className={`rounded-md border px-3 py-3 ${
                isReferenceReady ? "border-blue-200 bg-blue-50 text-blue-800" : "border-neutral-200 bg-neutral-50 text-neutral-600"
              }`}
              data-reference-state={isReferenceReady ? "ready" : "none"}
              data-testid="reference-state"
            >
              <div className="flex items-start gap-2">
                <ImageIcon className={`mt-0.5 size-4 ${isReferenceReady ? "text-blue-600" : "text-neutral-400"}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {referenceStateTitle}
                  </p>
                  <p className="mt-1 text-xs leading-5" data-testid="reference-hint">
                    {referenceStateHint}
                  </p>
                  {activeReferenceItems.length > 0 ? (
                    <div className="reference-preview-list">
                      {activeReferenceItems.map((reference, index) => (
                        <div className="reference-preview-card" key={`${reference.sourceUrl}-${index}`}>
                          <span className="reference-preview-card__index">{index + 1}</span>
                          <img
                            alt={t("generationReferenceAlt", { index: index + 1, name: reference.name })}
                            className="reference-preview-card__image"
                            src={reference.sourceUrl}
                          />
                          <p className="min-w-0 flex-1 truncate text-xs font-medium" data-testid="reference-name">
                            {reference.name}
                            <span>{Math.round(reference.width)} x {Math.round(reference.height)}</span>
                          </p>
                        </div>
                      ))}
                      <button
                        className="secondary-action h-8 shrink-0 px-2 text-xs"
                        type="button"
                        data-testid="cancel-reference"
                        onClick={cancelReferenceSelection}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                        {t("generationCancelReference")}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          <label className="block">
            <span className="control-label">{t("generationStyleLabel")}</span>
            <select
              className="field-control"
              id="style-preset"
              name="stylePreset"
              value={stylePreset}
              data-testid="style-preset"
              onChange={(event) => setStylePreset(event.target.value as StylePresetId)}
            >
              {STYLE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {t("stylePresetLabel", { presetId: preset.id, fallback: preset.label })}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="control-label">{t("generationSizeLabel")}</span>
            <div className="quick-size-grid" data-testid="quick-size-presets">
              {quickSizePresets.map((preset) => (
                <button
                  aria-pressed={sizePresetId === preset.id}
                  className={sizePresetId === preset.id ? "quick-size-button is-active" : "quick-size-button"}
                  key={preset.id}
                  type="button"
                  onClick={() => selectScenePreset(preset.id)}
                >
                  <span>{sizePresetLabel(preset, t)}</span>
                  <small>
                    {preset.width} x {preset.height}
                  </small>
                </button>
              ))}
              <button
                aria-pressed={sizePresetId === CUSTOM_SIZE_PRESET_ID}
                className={sizePresetId === CUSTOM_SIZE_PRESET_ID ? "quick-size-button is-active" : "quick-size-button"}
                type="button"
                onClick={() => selectScenePreset(CUSTOM_SIZE_PRESET_ID)}
              >
                <span>{t("customSize")}</span>
                <small>{t("customSizeManual")}</small>
              </button>
            </div>
            <label className="mt-3 block">
              <span className="sr-only">{t("generationAllSizes")}</span>
              <select
                className="field-control"
                id="scene-preset"
                name="scenePreset"
                value={sizePresetId}
                data-testid="scene-preset"
                onChange={(event) => selectScenePreset(event.target.value)}
              >
                {SIZE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {sizePresetOptionLabel(preset, t)}
                  </option>
                ))}
                <option value={CUSTOM_SIZE_PRESET_ID}>{t("customSizeOption")}</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="control-label">{t("generationWidthLabel")}</span>
              <input
                className="field-control"
                id="custom-width"
                min={MIN_IMAGE_DIMENSION}
                max={MAX_IMAGE_DIMENSION}
                name="width"
                step={1}
                type="number"
                value={Number.isNaN(width) ? "" : width}
                data-testid="custom-width"
                onChange={(event) => updateWidth(event.target.value)}
              />
            </label>
            <label>
              <span className="control-label">{t("generationHeightLabel")}</span>
              <input
                className="field-control"
                id="custom-height"
                min={MIN_IMAGE_DIMENSION}
                max={MAX_IMAGE_DIMENSION}
                name="height"
                step={1}
                type="number"
                value={Number.isNaN(height) ? "" : height}
                data-testid="custom-height"
                onChange={(event) => updateHeight(event.target.value)}
              />
            </label>
          </div>

          <div>
            <span className="control-label">{t("generationCountLabel")}</span>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {PRIMARY_GENERATION_COUNTS.map((item) => (
                <button
                  className={item === count ? "segmented-control is-active" : "segmented-control"}
                  key={item}
                  type="button"
                  onClick={() => setCount(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            <details className="group mt-2 rounded-md border border-neutral-200 bg-neutral-50">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium text-neutral-800">
                <span>{isExtendedCountSelected ? t("generationMoreCountSelected", { count }) : t("generationMoreCount")}</span>
                <ChevronDown className="size-4 shrink-0 text-neutral-500 transition group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="grid grid-cols-2 gap-2 border-t border-neutral-200 px-3 py-3">
                {EXTENDED_GENERATION_COUNTS.map((item) => (
                  <button
                    className={item === count ? "segmented-control is-active" : "segmented-control"}
                    key={item}
                    type="button"
                    onClick={() => setCount(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </details>
          </div>

          <details className="rounded-md border border-neutral-200 bg-neutral-50">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3 text-sm font-medium text-neutral-800">
              {t("generationAdvanced")}
              <ChevronDown className="size-4 text-neutral-500" aria-hidden="true" />
            </summary>
            <div className="space-y-4 border-t border-neutral-200 px-3 py-4">
              <label className="block">
                <span className="control-label">{t("generationQualityLabel")}</span>
                <select
                  className="field-control"
                  id="quality-select"
                  name="quality"
                  value={quality}
                  data-testid="quality-select"
                  onChange={(event) => setQuality(event.target.value as ImageQuality)}
                >
                  {IMAGE_QUALITIES.map((item) => (
                    <option key={item} value={item}>
                      {t("qualityLabel", { quality: item })}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="control-label">{t("generationOutputFormatLabel")}</span>
                <select
                  className="field-control"
                  id="format-select"
                  name="outputFormat"
                  value={outputFormat}
                  data-testid="format-select"
                  onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}
                >
                  {OUTPUT_FORMATS.map((item) => (
                    <option key={item} value={item}>
                      {t("outputFormatLabel", { format: item })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </details>

          <section className="space-y-3" data-history-expanded={isHistoryExpanded} data-testid="generation-history">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-neutral-950">{t("generationHistoryTitle")}</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-500">{t("generationHistoryCount", { count: generationHistory.length })}</span>
                {hasAdditionalHistory ? (
                  <button
                    aria-expanded={isHistoryExpanded}
                    className="history-toggle"
                    data-testid="history-toggle"
                    type="button"
                    onClick={() => setIsHistoryExpanded((expanded) => !expanded)}
                  >
                    {isHistoryExpanded ? t("galleryToggleCollapse") : t("generationHistoryExpand", { count: hiddenHistoryCount })}
                    <ChevronDown className={`size-3.5 transition ${isHistoryExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>

            {generationHistory.length === 0 ? (
              <p className="rounded-md border border-dashed border-neutral-300 px-3 py-4 text-sm text-neutral-500">
                {t("generationEmptyHistory")}
              </p>
            ) : (
              <div className="history-list">
                {visibleHistory.map((record) => {
                  const downloadableAsset = firstDownloadableAsset(record);
                  const excerpt = promptExcerpt(record.prompt);
                  const totalOutputs = record.outputs.length || record.count;
                  const activeTask = activeGenerationsRef.current.get(record.id);
                  const isRecordRunning = isActiveGenerationRecord(record) && Boolean(activeTask);
                  const cloudFailedCount = cloudFailureCount(record);
                  const cloudFailureMessage = firstCloudFailureMessage(record);

                  return (
                    <article
                      className="history-item"
                      data-testid="history-record"
                      key={record.id}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`history-status-pill ${historyStatusStyles[record.status]}`}>
                            {t("statusLabel", { status: record.status })}
                          </span>
                          <span className="truncate text-xs text-neutral-500">{t("modeLabel", { mode: record.mode })}</span>
                        </div>
                        <p className="mt-1 truncate text-sm font-medium leading-5 text-neutral-950" title={record.prompt}>
                          {excerpt}
                        </p>
                        <dl className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs leading-5 text-neutral-500">
                          <div className="inline-flex items-center gap-1">
                            <dt className="sr-only">{t("generationHistorySize")}</dt>
                            <dd>
                              {record.size.width} x {record.size.height}
                            </dd>
                          </div>
                          <div className="inline-flex items-center gap-1">
                            <dt className="sr-only">{t("generationHistoryOutputCount")}</dt>
                            <dd>
                              {t("generationImageOutputCount", { successful: successfulOutputCount(record), total: totalOutputs })}
                            </dd>
                          </div>
                          <div className="inline-flex items-center gap-1">
                            <dt className="sr-only">{t("generationHistoryCreatedAt")}</dt>
                            <dd>{formatCreatedTime(record.createdAt, formatDateTime)}</dd>
                          </div>
                          {cloudFailedCount > 0 ? (
                            <div className="inline-flex items-center gap-1 text-amber-700" title={cloudFailureMessage}>
                              <dt className="sr-only">{t("generationHistoryCloudBackup")}</dt>
                              <dd className="inline-flex items-center gap-1">
                                <Cloud className="size-3" aria-hidden="true" />
                                {t("generationCloudFailed", { count: cloudFailedCount })}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>

                      <div className="history-actions">
                        <button
                          aria-label={t("generationHistoryCopyPrompt", { excerpt })}
                          className="history-icon-action"
                          type="button"
                          data-testid="history-copy-prompt"
                          title={t("galleryPromptLabel")}
                          onClick={() => void copyHistoryPrompt(record)}
                        >
                          <Copy className="size-4" aria-hidden="true" />
                        </button>
                        <button
                          aria-label={t("generationHistoryLocate", { excerpt })}
                          className="history-icon-action"
                          type="button"
                          data-testid="history-locate"
                          title={t("historyLocate")}
                          onClick={() => locateHistoryRecord(record)}
                        >
                          <MapPin className="size-4" aria-hidden="true" />
                        </button>
                        <button
                          aria-label={t("generationHistoryRerun", { excerpt })}
                          className="history-icon-action"
                          type="button"
                          data-testid="history-rerun"
                          disabled={isRecordRunning}
                          title={isRecordRunning ? t("generationRerunRunning") : t("historyRerun")}
                          onClick={() => void rerunHistoryRecord(record)}
                        >
                          <RotateCcw className="size-4" aria-hidden="true" />
                        </button>
                        {activeTask && isActiveGenerationRecord(record) ? (
                          <button
                            aria-label={t("historyCancelTask", { excerpt })}
                            className="history-icon-action"
                            type="button"
                            data-testid="history-cancel"
                            title={t("commonCancel")}
                            onClick={() => void cancelGeneration(activeTask.requestId)}
                          >
                            <XCircle className="size-4" aria-hidden="true" />
                          </button>
                        ) : (
                          <button
                            aria-label={t("generationHistoryDownload", { excerpt })}
                            className="history-icon-action"
                            type="button"
                            data-testid="history-download"
                            disabled={!downloadableAsset}
                            title={downloadableAsset ? t("commonDownload") : t("generationHistoryNoDownload")}
                            onClick={() => downloadHistoryRecord(record)}
                          >
                            <Download className="size-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="ai-panel-actions ai-panel-tab-panel ai-panel-tab-panel--actions grid grid-cols-1 gap-3 border-t border-neutral-200 bg-white px-5 py-4" data-tab="manual">
          {panelStatus ? (
            <div
              aria-live={panelStatus.tone === "progress" ? "polite" : "assertive"}
              className={`action-feedback panel-status-strip panel-status--${panelStatus.tone}`}
              data-testid={`action-${panelStatus.testId}`}
              role={panelStatus.tone === "success" || panelStatus.tone === "progress" ? "status" : "alert"}
            >
              {panelStatus.message}
            </div>
          ) : null}
          <button
            className="primary-action"
            disabled={!canGenerate}
            type="button"
            data-generation-mode={generationMode}
            data-reference-mode={isReferenceReady ? "edit" : "generate"}
            data-testid="generate-button"
            title={generationSubmitAction === "generate" ? validationMessage || undefined : undefined}
            onClick={() => void submitGeneration()}
          >
            {isReferenceReady ? (
              <ImageIcon className="size-4" aria-hidden="true" />
            ) : (
              <Square className="size-4" aria-hidden="true" />
            )}
            {generationSubmitAction === "configure-image-model"
              ? t("generationConfigureImageModel")
              : generationMode === "reference"
                ? t("generationStartReference")
                : t("generationStartText")}
          </button>
        </div>
        </>
        ) : (
        <>
        <div className="ai-panel-body ai-panel-tab-panel ai-panel-tab-panel--body agent-panel-body flex-1 px-5 py-4" data-tab="agent" data-testid="agent-tab-panel">
          {saveError ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="save-error">
              {saveError}
            </p>
          ) : null}

          <div className="agent-chat-head" data-testid="agent-config-state" data-configured={isAgentConfigured}>
            <button
              className="agent-model-pill"
              data-configured={isAgentConfigured}
              type="button"
              onClick={() => openProviderConfigDialog("agent")}
            >
              <span className="agent-model-pill__icon" data-state={isAgentConfigured ? "ready" : "missing"}>
                {isAgentConfigLoading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : isAgentConfigured ? (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4" aria-hidden="true" />
                )}
              </span>
              <span className="agent-model-pill__copy">
                <strong>
                  {isAgentConfigLoading
                    ? t("agentConfigLoading")
                    : isAgentConfigured
                      ? t(agentConfig?.supportsVision ? "agentVisionMode" : "agentTextOnlyMode")
                      : t("agentConfigMissingTitle")}
                </strong>
                <span>{agentConfigError || (isAgentConfigured ? t("agentConfigReadyCopy", { model: agentConfig?.model ?? "" }) : t("agentOpenModelConfig"))}</span>
              </span>
            </button>
            <div className="agent-chat-head__actions">
              <button
                aria-label={t("agentSkillsOpen")}
                className="agent-icon-button"
                data-testid="agent-skills-open"
                title={t("agentSkillsOpen")}
                type="button"
                onClick={() => setIsAgentSkillDialogOpen(true)}
              >
                <BookOpenCheck className="size-4" aria-hidden="true" />
              </button>
              <button
                aria-label={t("agentConfigRefresh")}
                className="agent-icon-button"
                data-testid="agent-config-refresh"
                disabled={isAgentConfigLoading}
                title={t("agentConfigRefresh")}
                type="button"
                onClick={() => void loadAgentConfig()}
              >
                {isAgentConfigLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="size-4" aria-hidden="true" />}
              </button>
              <button
                aria-label={t("agentHistoryOpen")}
                className="agent-icon-button"
                data-testid="agent-history-open"
                title={t("agentHistoryOpen")}
                type="button"
                onClick={openAgentHistoryDialog}
              >
                <History className="size-4" aria-hidden="true" />
              </button>
              <button
                aria-label={t("agentNewConversation")}
                className="agent-icon-button"
                data-testid="agent-new-conversation"
                disabled={isAgentRunning}
                title={t("agentNewConversation")}
                type="button"
                onClick={startNewAgentConversation}
              >
                <MessageCirclePlus className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <section className="agent-transcript" aria-label={t("agentTranscriptLabel")} data-testid="agent-transcript" ref={agentTranscriptRef}>
            {agentMessages.length === 0 ? (
              <div className="agent-empty-state">
                <Bot className="size-5" aria-hidden="true" />
                <p>{t("agentEmptyTitle")}</p>
                <span>{t("agentEmptyCopy")}</span>
              </div>
            ) : (
              agentMessages.map((message) => {
                const canCopyAgentMessage = isCopyableAgentMessageRole(message.role) && message.content.trim().length > 0;
                const isAgentMessageCopied = copiedAgentMessageId === message.id;
                const copyMessageLabel = isAgentMessageCopied ? t("agentCopiedMessage") : t("agentCopyMessage");
                const hasThinkingDetails = message.role === "thinking" && Boolean(message.details?.trim());
                const isThinkingExpanded = hasThinkingDetails && expandedThinkingMessageIds.includes(message.id);
                const thinkingToggleLabel = hasThinkingDetails ? agentThinkingRawToggleLabel(locale, isThinkingExpanded) : "";
                const previewCount = message.previews?.length ?? 0;

                return (
                  <article
                    className={`agent-message agent-message--${message.role}`}
                    data-message-role={message.role}
                    data-run-id={message.runId}
                    data-testid="agent-message"
                    key={message.id}
                  >
                    {message.role === "system" || message.role === "error" ? (
                      <div className="agent-status-line__meta">
                        <span>{t("agentMessageRole", { role: message.role })}</span>
                        <time dateTime={message.timestamp}>{formatDateTime(message.timestamp, { hour: "2-digit", minute: "2-digit" })}</time>
                      </div>
                    ) : (
                      <div className="agent-message__meta">
                        <span>{t("agentMessageRole", { role: message.role })}</span>
                        <span className="agent-message__meta-actions">
                          <time dateTime={message.timestamp}>{formatDateTime(message.timestamp, { hour: "2-digit", minute: "2-digit" })}</time>
                          {canCopyAgentMessage ? (
                            <button
                              aria-label={copyMessageLabel}
                              className="agent-message-copy-button"
                              data-copied={isAgentMessageCopied}
                              title={copyMessageLabel}
                              type="button"
                              onClick={() => void copyAgentMessage(message)}
                            >
                              <span className="agent-message-copy-button__icon-stack" aria-hidden="true">
                                <Copy className="agent-message-copy-button__icon agent-message-copy-button__icon--copy size-3.5" />
                                <Check className="agent-message-copy-button__icon agent-message-copy-button__icon--check size-3.5" />
                              </span>
                            </button>
                          ) : null}
                        </span>
                      </div>
                    )}
                    <p className="agent-message__content">{message.content}</p>
                    {hasThinkingDetails ? (
                      <div className="agent-thinking-details">
                        <button
                          aria-expanded={isThinkingExpanded}
                          aria-label={thinkingToggleLabel}
                          className="agent-thinking-details__toggle"
                          data-testid="agent-thinking-toggle"
                          type="button"
                          onClick={() => toggleThinkingMessage(message.id)}
                        >
                          <span>{thinkingToggleLabel}</span>
                          <ChevronDown className="size-3.5" aria-hidden="true" data-expanded={isThinkingExpanded} />
                        </button>
                        {isThinkingExpanded ? (
                          <pre className="agent-thinking-details__content" data-testid="agent-thinking-content">
                            {message.details}
                          </pre>
                        ) : null}
                      </div>
                    ) : null}
                    {message.plan ? (
                      <AgentPlanCard
                        isAgentConfigured={isAgentConfigured}
                        isAgentRunning={isAgentRunning}
                        plan={message.plan}
                        t={t}
                        onAction={(plan, action) => void sendAgentPlanAction(plan, action)}
                      />
                    ) : null}
                    {previewCount > 0 && message.previews ? (
                      <details className="agent-preview-disclosure">
                        <summary className="agent-preview-disclosure__summary">
                          <span>{agentPreviewDisclosureLabel(locale, previewCount)}</span>
                          <ChevronDown className="agent-preview-disclosure__icon size-3.5" aria-hidden="true" />
                        </summary>
                        <div className="agent-preview-list">
                          {message.previews.map((preview) => (
                            <button
                              aria-label={t("agentPreviewLocate")}
                              className="agent-preview-button"
                              key={preview.id}
                              type="button"
                              onClick={() => locateAgentPreview(preview)}
                            >
                              <img alt="" src={preview.url} />
                              <MapPin className="size-3.5" aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      </details>
                    ) : null}
                  </article>
                );
              })
            )}
          </section>
        </div>

        <div className="ai-panel-actions ai-panel-tab-panel ai-panel-tab-panel--actions agent-panel-actions agent-composer-shell border-t border-neutral-200 bg-white px-5 py-4" data-tab="agent">
          <div className="agent-param-bar">
            <div className="agent-param-group">
              <button
                aria-expanded={isAgentSettingsOpen}
                aria-label={t("agentOpenParameters")}
                className="agent-param-chip agent-param-chip--primary"
                data-testid="agent-parameter-toggle"
                title={agentSizeSummary}
                type="button"
                onClick={() => setIsAgentSettingsOpen((isOpen) => !isOpen)}
              >
                <Settings className="size-3.5" aria-hidden="true" />
                <span>{agentCompactSizeSummary}</span>
              </button>
              <button
                aria-expanded={isAgentSettingsOpen}
                className="agent-param-chip"
                title={agentQualitySummary}
                type="button"
                onClick={() => setIsAgentSettingsOpen((isOpen) => !isOpen)}
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                <span>{agentQualitySummary}</span>
              </button>
              <button
                aria-expanded={isAgentSettingsOpen}
                className="agent-param-chip"
                title={agentFormatSummary}
                type="button"
                onClick={() => setIsAgentSettingsOpen((isOpen) => !isOpen)}
              >
                <ImageIcon className="size-3.5" aria-hidden="true" />
                <span>{agentFormatSummary}</span>
              </button>
              {supportsAgentThinkingControls ? (
                <button
                  aria-expanded={isAgentSettingsOpen}
                  className="agent-param-chip"
                  data-testid="agent-thinking-chip"
                  title={agentThinkingSummary}
                  type="button"
                  onClick={() => setIsAgentSettingsOpen((isOpen) => !isOpen)}
                >
                  <BrainCircuit className="size-3.5" aria-hidden="true" />
                  <span>{agentThinkingSummary}</span>
                </button>
              ) : null}
              <button
                aria-expanded={isAgentSettingsOpen}
                className="agent-param-chip"
                data-testid="agent-reference-state"
                title={agentReferenceSummary}
                type="button"
                onClick={() => setIsAgentSettingsOpen((isOpen) => !isOpen)}
              >
                <MapPin className="size-3.5" aria-hidden="true" />
                <span>{agentReferenceCompactSummary}</span>
              </button>
            </div>
          </div>

          {isAgentSettingsOpen ? (
            <section className="agent-parameter-popover" aria-label={t("agentDefaultsTitle")} data-testid="agent-parameter-popover">
              <div className="agent-parameter-popover__header">
                <div>
                  <strong>{t("agentDefaultsTitle")}</strong>
                  <span>
                    {agentSizeSummary} / {agentQualitySummary} / {agentFormatSummary}
                  </span>
                </div>
                <button className="agent-parameter-popover__close" type="button" aria-label={t("commonClose")} onClick={() => setIsAgentSettingsOpen(false)}>
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>

              <div className="agent-parameter-popover__section agent-parameter-popover__section--size">
                <div className="agent-parameter-popover__section-head">
                  <span className="control-label">{t("generationSizeLabel")}</span>
                  <strong>{agentSizeSummary}</strong>
                </div>
                <div className="agent-size-preset-grid" data-testid="agent-size-preset-buttons">
                  {agentSizePresetButtons.map((preset) => (
                    <button
                      aria-pressed={agentSizePresetId === preset.id}
                      className="agent-size-preset-button"
                      data-selected={agentSizePresetId === preset.id}
                      key={preset.id}
                      type="button"
                      onClick={() => selectAgentSizePreset(preset.id)}
                    >
                      <span>{sizePresetLabel(preset, t)}</span>
                      <small>
                        {preset.width} x {preset.height}
                      </small>
                    </button>
                  ))}
                  <button
                    aria-pressed={agentSizePresetId === CUSTOM_SIZE_PRESET_ID}
                    className="agent-size-preset-button"
                    data-selected={agentSizePresetId === CUSTOM_SIZE_PRESET_ID}
                    type="button"
                    onClick={() => selectAgentSizePreset(CUSTOM_SIZE_PRESET_ID)}
                  >
                    <span>{t("customSize")}</span>
                    <small>{t("customSizeManual")}</small>
                  </button>
                </div>
                <label className="agent-compact-field agent-compact-field--select">
                  <span className="control-label">{t("generationAllSizes")}</span>
                  <select
                    className="field-control"
                    data-testid="agent-size-preset"
                    value={agentSizePresetId}
                    onChange={(event) => selectAgentSizePreset(event.target.value)}
                  >
                    {SIZE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {sizePresetOptionLabel(preset, t)}
                      </option>
                    ))}
                    <option value={CUSTOM_SIZE_PRESET_ID}>{t("customSizeOption")}</option>
                  </select>
                </label>
                <div className="agent-dimension-grid">
                  <label className="agent-compact-field">
                    <span className="control-label">{t("generationWidthLabel")}</span>
                    <input
                      className="field-control"
                      data-testid="agent-width"
                      max={MAX_IMAGE_DIMENSION}
                      min={MIN_IMAGE_DIMENSION}
                      step={1}
                      type="number"
                      value={Number.isNaN(agentWidth) ? "" : agentWidth}
                      onChange={(event) => updateAgentWidth(event.target.value)}
                    />
                  </label>
                  <label className="agent-compact-field">
                    <span className="control-label">{t("generationHeightLabel")}</span>
                    <input
                      className="field-control"
                      data-testid="agent-height"
                      max={MAX_IMAGE_DIMENSION}
                      min={MIN_IMAGE_DIMENSION}
                      step={1}
                      type="number"
                      value={Number.isNaN(agentHeight) ? "" : agentHeight}
                      onChange={(event) => updateAgentHeight(event.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className="agent-parameter-popover__section">
                <div className="agent-output-grid">
                  <label className="agent-compact-field">
                    <span className="control-label">{t("generationQualityLabel")}</span>
                    <select
                      className="field-control"
                      data-testid="agent-quality"
                      value={agentQuality}
                      onChange={(event) => setAgentQuality(event.target.value as ImageQuality)}
                    >
                      {IMAGE_QUALITIES.map((item) => (
                        <option key={item} value={item}>
                          {t("qualityLabel", { quality: item })}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="agent-compact-field">
                    <span className="control-label">{t("generationOutputFormatLabel")}</span>
                    <select
                      className="field-control"
                      data-testid="agent-format"
                      value={agentOutputFormat}
                      onChange={(event) => setAgentOutputFormat(event.target.value as OutputFormat)}
                    >
                      {OUTPUT_FORMATS.map((item) => (
                        <option key={item} value={item}>
                          {t("outputFormatLabel", { format: item })}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              {agentDefaultsValidationMessage ? (
                <p className="agent-inline-warning" role="alert">
                  {agentDefaultsValidationMessage}
                </p>
              ) : null}
              {supportsAgentThinkingControls ? (
                <section className="agent-thinking-controls" aria-label={agentThinkingModeLabel(locale)} data-testid="agent-thinking-controls">
                  <div className="agent-thinking-controls__header">
                    <div>
                      <strong>{agentThinkingModeLabel(locale)}</strong>
                      <span>{agentThinkingSummary}</span>
                    </div>
                  </div>
                  <div className="agent-thinking-controls__group" role="group" aria-label={agentThinkingModeLabel(locale)}>
                    <button
                      aria-pressed={agentThinkingType === "enabled"}
                      className="agent-thinking-controls__option"
                      data-selected={agentThinkingType === "enabled"}
                      data-testid="agent-thinking-enabled"
                      type="button"
                      onClick={() => setAgentThinkingType("enabled")}
                    >
                      {agentThinkingEnabledLabel(locale)}
                    </button>
                    <button
                      aria-pressed={agentThinkingType === "disabled"}
                      className="agent-thinking-controls__option"
                      data-selected={agentThinkingType === "disabled"}
                      data-testid="agent-thinking-disabled"
                      type="button"
                      onClick={() => setAgentThinkingType("disabled")}
                    >
                      {agentThinkingDisabledLabel(locale)}
                    </button>
                  </div>
                  <div className="agent-thinking-controls__effort">
                    <span className="control-label">{agentThinkingEffortLabel(locale)}</span>
                    <div className="agent-thinking-controls__group" role="group" aria-label={agentThinkingEffortLabel(locale)}>
                      <button
                        aria-pressed={agentReasoningEffort === "high"}
                        className="agent-thinking-controls__option"
                        data-selected={agentReasoningEffort === "high"}
                        data-testid="agent-thinking-effort-high"
                        disabled={agentThinkingType === "disabled"}
                        type="button"
                        onClick={() => setAgentReasoningEffort("high")}
                      >
                        High
                      </button>
                      <button
                        aria-pressed={agentReasoningEffort === "max"}
                        className="agent-thinking-controls__option"
                        data-selected={agentReasoningEffort === "max"}
                        data-testid="agent-thinking-effort-max"
                        disabled={agentThinkingType === "disabled"}
                        type="button"
                        onClick={() => setAgentReasoningEffort("max")}
                      >
                        Max
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}
              <div className="agent-reference-summary">
                <div>
                  <strong>{t("agentReferencesTitle")}</strong>
                  <span>{agentReferenceSelection.hint}</span>
                </div>
                <span>{agentReferenceSelection.references.length} / {MAX_AGENT_SELECTED_REFERENCES}</span>
              </div>
              {agentReferenceSelection.warning ? (
                <p className="agent-inline-warning" data-testid="agent-reference-warning" role="alert">
                  {agentReferenceSelection.warning}
                </p>
              ) : null}
              {agentReferenceSelection.references.length > 0 ? (
                <div className="agent-reference-list">
                  {agentReferenceSelection.references.map((reference, index) => (
                    <article className="agent-reference-item" data-testid="agent-reference-item" key={`${reference.sourceUrl}-${index}`}>
                      <img
                        alt={t("generationReferenceAlt", { index: index + 1, name: agentReferenceLabel(reference, index, t) })}
                        className="agent-reference-item__image"
                        src={reference.sourceUrl}
                      />
                      <div className="min-w-0">
                        <p>{agentReferenceLabel(reference, index, t)}</p>
                        <span>{Math.round(reference.width)} x {Math.round(reference.height)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <div className="agent-composer-row">
            <label className="agent-composer-input">
              <span className="sr-only">{t("agentInputLabel")}</span>
              <textarea
                className="agent-input"
                data-testid="agent-message-input"
                disabled={isAgentRunning}
                placeholder={isAgentConfigured ? t("agentInputPlaceholder") : t("agentConfigMissingInputPlaceholder")}
                rows={2}
                value={agentInput}
                onChange={(event) => setAgentInput(event.target.value)}
              />
            </label>
            {isAgentRunning ? (
              <button
                aria-label={agentCancelRunLabel}
                className="agent-send-or-cancel"
                data-state={agentRunStatus}
                data-testid="agent-cancel-button"
                title={agentCancelRunLabel}
                type="button"
                onClick={cancelAgentRun}
              >
                <CircleStop className="size-4" aria-hidden="true" />
              </button>
            ) : (
              <button
                aria-label={t("agentSend")}
                className="agent-send-or-cancel"
                data-state={agentRunStatus}
                data-testid="agent-send-button"
                disabled={!canSendAgentMessage}
                title={!isAgentConfigured ? t("agentConfigMissingTitle") : agentDefaultsValidationMessage || undefined}
                type="button"
                onClick={() => void submitAgentMessage()}
              >
                <Send className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        </>
        )}
      </aside>

      {isAgentHistoryOpen ? (
        <AgentHistoryDialog
          conversation={selectedAgentConversation}
          error={agentHistoryError}
          formatDateTime={formatDateTime}
          isDetailLoading={isAgentHistoryDetailLoading}
          isLoading={isAgentHistoryLoading}
          isRestoringDisabled={isAgentRunning}
          selectedConversationId={selectedAgentHistoryId}
          summaries={agentHistorySummaries}
          t={t}
          onClose={closeAgentHistoryDialog}
          onRestore={restoreAgentConversation}
          onSelectConversation={selectAgentHistoryConversation}
        />
      ) : null}

      {isAgentSkillDialogOpen ? (
        <Suspense fallback={null}>
          <LazyAgentSkillDialog onClose={() => setIsAgentSkillDialogOpen(false)} />
        </Suspense>
      ) : null}

      {isStorageDialogOpen ? (
        <div className="app-modal-backdrop fixed inset-0 z-[3000] flex items-center justify-center bg-neutral-950/45 px-4 py-6" data-testid="storage-dialog">
          <div
            aria-labelledby="storage-dialog-title"
            aria-modal="true"
            className="app-modal-surface flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl"
            role="dialog"
          >
            <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-neutral-950" id="storage-dialog-title">
                  {t("storageSettings")}
                </h2>
                <p className="mt-1 text-xs leading-5 text-neutral-500">{t("storageSubtitle")}</p>
              </div>
              <button
                aria-label={t("storageClose")}
                className="history-icon-action"
                type="button"
                onClick={closeStorageDialog}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-5 py-5">
              {storageError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-red-700" role="alert">
                  {storageError}
                </p>
              ) : null}
              {storageMessage ? (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm leading-5 text-emerald-700" role="status">
                  {storageMessage}
                </p>
              ) : null}

              <label className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-neutral-900">{t("storageEnabledLabel")}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-neutral-500">{t("storageEnabledCopy")}</span>
                </span>
                <input
                  checked={storageForm.enabled}
                  className="size-4 accent-amber-600"
                  data-testid="storage-enabled"
                  id="storage-enabled"
                  name="storageEnabled"
                  type="checkbox"
                  onChange={(event) => updateStorageForm({ enabled: event.target.checked })}
                />
              </label>

              <div className="space-y-2">
                <p className="control-label">{t("storageProviderLabel")}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    className={`rounded-md border px-3 py-3 text-left transition-colors ${
                      storageForm.provider === "cos"
                        ? "border-amber-500 bg-amber-50 text-neutral-950"
                        : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                    }`}
                    type="button"
                    onClick={() => updateStorageProvider("cos")}
                  >
                    <span className="block text-sm font-semibold">{t("storageProviderCosTitle")}</span>
                    <span className="mt-1 block text-xs leading-5 text-neutral-500">{t("storageProviderCosCopy")}</span>
                  </button>
                  <button
                    className={`rounded-md border px-3 py-3 text-left transition-colors ${
                      storageForm.provider === "s3"
                        ? "border-emerald-500 bg-emerald-50 text-neutral-950"
                        : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
                    }`}
                    type="button"
                    onClick={() => updateStorageProvider("s3")}
                  >
                    <span className="block text-sm font-semibold">{t("storageProviderS3Title")}</span>
                    <span className="mt-1 block text-xs leading-5 text-neutral-500">{t("storageProviderS3Copy")}</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {storageForm.provider === "cos" ? (
                  <>
                    <label className="block sm:col-span-2">
                      <span className="control-label">SecretId</span>
                      <input
                        className="field-control"
                        data-testid="storage-secret-id"
                        id="storage-secret-id"
                        name="storageSecretId"
                        value={storageForm.cos.secretId}
                        onChange={(event) => updateStorageCosForm({ secretId: event.target.value })}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="control-label">SecretKey</span>
                      <input
                        className="field-control"
                        data-testid="storage-secret-key"
                        id="storage-secret-key"
                        name="storageSecretKey"
                        type={storageSecretTouched.cos ? "password" : "text"}
                        value={storageForm.cos.secretKey}
                        onChange={(event) => {
                          setStorageSecretTouched((current) => ({ ...current, cos: true }));
                          updateStorageCosForm({ secretKey: event.target.value });
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="control-label">{t("storageBucket")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-bucket"
                        id="storage-bucket"
                        name="storageBucket"
                        value={storageForm.cos.bucket}
                        onChange={(event) => updateStorageCosForm({ bucket: event.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="control-label">{t("storageRegion")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-region"
                        id="storage-region"
                        name="storageRegion"
                        value={storageForm.cos.region}
                        onChange={(event) => updateStorageCosForm({ region: event.target.value })}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="control-label">{t("storageKeyPrefix")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-prefix"
                        id="storage-prefix"
                        name="storagePrefix"
                        value={storageForm.cos.keyPrefix}
                        onChange={(event) => updateStorageCosForm({ keyPrefix: event.target.value })}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="block sm:col-span-2">
                      <span className="control-label">{t("storageEndpointMode")}</span>
                      <select
                        className="field-control"
                        data-testid="storage-s3-endpoint-mode"
                        id="storage-s3-endpoint-mode"
                        name="storageS3EndpointMode"
                        value={storageForm.s3.endpointMode}
                        onChange={(event) => updateStorageS3Form({ endpointMode: event.target.value === "custom" ? "custom" : "r2-account" })}
                      >
                        <option value="r2-account">{t("storageEndpointModeR2")}</option>
                        <option value="custom">{t("storageEndpointModeCustom")}</option>
                      </select>
                    </label>
                    {storageForm.s3.endpointMode === "r2-account" ? (
                      <label className="block sm:col-span-2">
                        <span className="control-label">{t("storageAccountId")}</span>
                        <input
                          className="field-control"
                          data-testid="storage-s3-account-id"
                          id="storage-s3-account-id"
                          name="storageS3AccountId"
                          value={storageForm.s3.accountId}
                          onChange={(event) => updateStorageS3Form({ accountId: event.target.value })}
                        />
                      </label>
                    ) : (
                      <label className="block sm:col-span-2">
                        <span className="control-label">{t("storageEndpointUrl")}</span>
                        <input
                          className="field-control"
                          data-testid="storage-s3-endpoint"
                          id="storage-s3-endpoint"
                          name="storageS3Endpoint"
                          value={storageForm.s3.endpoint}
                          onChange={(event) => updateStorageS3Form({ endpoint: event.target.value })}
                        />
                      </label>
                    )}
                    <label className="block sm:col-span-2">
                      <span className="control-label">{t("storageAccessKeyId")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-s3-access-key-id"
                        id="storage-s3-access-key-id"
                        name="storageS3AccessKeyId"
                        value={storageForm.s3.accessKeyId}
                        onChange={(event) => updateStorageS3Form({ accessKeyId: event.target.value })}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="control-label">{t("storageSecretAccessKey")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-s3-secret-access-key"
                        id="storage-s3-secret-access-key"
                        name="storageS3SecretAccessKey"
                        type={storageSecretTouched.s3 ? "password" : "text"}
                        value={storageForm.s3.secretAccessKey}
                        onChange={(event) => {
                          setStorageSecretTouched((current) => ({ ...current, s3: true }));
                          updateStorageS3Form({ secretAccessKey: event.target.value });
                        }}
                      />
                    </label>
                    <label className="block">
                      <span className="control-label">{t("storageBucket")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-s3-bucket"
                        id="storage-s3-bucket"
                        name="storageS3Bucket"
                        value={storageForm.s3.bucket}
                        onChange={(event) => updateStorageS3Form({ bucket: event.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className="control-label">{t("storageRegion")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-s3-region"
                        id="storage-s3-region"
                        name="storageS3Region"
                        value={storageForm.s3.region}
                        onChange={(event) => updateStorageS3Form({ region: event.target.value })}
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="control-label">{t("storageKeyPrefix")}</span>
                      <input
                        className="field-control"
                        data-testid="storage-s3-prefix"
                        id="storage-s3-prefix"
                        name="storageS3Prefix"
                        value={storageForm.s3.keyPrefix}
                        onChange={(event) => updateStorageS3Form({ keyPrefix: event.target.value })}
                      />
                    </label>
                    {storageForm.s3.endpointMode === "custom" ? (
                      <label className="flex items-center gap-2 sm:col-span-2">
                        <input
                          checked={storageForm.s3.forcePathStyle}
                          className="size-4 accent-emerald-600"
                          data-testid="storage-s3-force-path-style"
                          id="storage-s3-force-path-style"
                          name="storageS3ForcePathStyle"
                          type="checkbox"
                          onChange={(event) => updateStorageS3Form({ forcePathStyle: event.target.checked })}
                        />
                        <span className="text-sm text-neutral-700">{t("storageForcePathStyle")}</span>
                      </label>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-neutral-200 px-5 py-4">
              <button
                className="secondary-action h-10"
                data-testid="storage-test"
                disabled={isStorageTesting || isStorageSaving}
                type="button"
                onClick={() => void testStorageSettings()}
              >
                {isStorageTesting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Cloud className="size-4" aria-hidden="true" />}
                {t("storageTest")}
              </button>
              <button
                className="primary-action h-10"
                data-testid="storage-save"
                disabled={isStorageSaving || isStorageTesting}
                type="button"
                onClick={() => void saveStorageSettings()}
              >
                {isStorageSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
                {t("storageSave")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isCodexLoginOpen ? createPortal(
        (
        <div className="app-modal-backdrop fixed inset-0 z-[3000] flex items-center justify-center bg-neutral-950/45 px-4 py-6" data-testid="codex-login-dialog">
          <div
            aria-labelledby="codex-login-title"
            aria-modal="true"
            className="codex-login-dialog app-modal-surface"
            role="dialog"
          >
            <div className="codex-login-dialog__header">
              <div className="min-w-0">
                <h2 id="codex-login-title">{t("codexLoginTitle")}</h2>
                <p>{t("codexLoginSubtitle")}</p>
              </div>
              <button
                aria-label={t("codexCloseLogin")}
                className="history-icon-action"
                type="button"
                onClick={closeCodexLoginDialog}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="codex-login-dialog__body">
              {codexLoginStatus === "starting" ? (
                <div className="codex-login-dialog__status" role="status">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("codexCreatingCode")}
                </div>
              ) : null}

              {codexDevice ? (
                <>
                  <div className="codex-device-code" data-testid="codex-user-code">
                    {codexDevice.userCode}
                  </div>
                  <div className="codex-login-dialog__actions">
                    <a className="primary-action h-10" href={codexDevice.verificationUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="size-4" aria-hidden="true" />
                      {t("codexOpenLoginPage")}
                    </a>
                    <button className="secondary-action h-10" type="button" onClick={() => void copyCodexUserCode()}>
                      <Copy className="size-4" aria-hidden="true" />
                      {t("codexCopyCode")}
                    </button>
                  </div>
                  <p className="codex-login-dialog__hint">
                    {t("codexCodeExpires", { time: formatCodexExpiry(codexDevice.expiresAt, formatDateTime, t) })}
                  </p>
                </>
              ) : null}

              {codexLoginMessage ? (
                <p
                  className={`codex-login-dialog__message codex-login-dialog__message--${codexLoginStatus}`}
                  data-testid="codex-login-message"
                  role={codexLoginStatus === "pending" || codexLoginStatus === "authorized" ? "status" : "alert"}
                >
                  {codexLoginStatus === "pending" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  {codexLoginMessage}
                </p>
              ) : null}

              {codexLoginStatus === "expired" || codexLoginStatus === "denied" || codexLoginStatus === "error" ? (
                <button className="secondary-action h-10" type="button" onClick={() => void startCodexLogin()}>
                  <KeyRound className="size-4" aria-hidden="true" />
                  {t("codexRestart")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        ),
        document.body
      ) : null}
      </main>
      {regionFocusFrames.length > 0 || regionFocusPreviews.length > 0
        ? createPortal(
            <div className="region-focus-layer" data-theme={isCanvasDarkMode ? "dark" : "light"} aria-live="polite">
              {regionFocusFrames.map((frame) => (
                <span className="region-focus-frame" key={frame.id} style={regionFocusFrameStyle(frame)} aria-hidden="true" />
              ))}
              {regionFocusPreviews.map((preview, index) => (
                <aside
                  className="region-focus-card"
                  data-collapsed={preview.collapsed ? "true" : undefined}
                  data-dismissing={preview.dismissing ? "true" : undefined}
                  data-origin={preview.origin}
                  data-status={preview.status}
                  key={preview.id}
                  style={regionFocusPreviewStyle(preview, regionFocusPreviews.length - 1 - index)}
                >
                  <header className="region-focus-card__head">
                    <span className="region-focus-card__icon" aria-hidden="true">
                      {preview.status === "ready" ? <CheckCircle2 className="size-4" /> : <Sparkles className="size-3.5" />}
                    </span>
                    <div>
                      <strong>{preview.label || t("regionPromptFocusTitle")}</strong>
                      <span>{preview.status === "ready" ? t("regionPromptFocusReady") : t("regionPromptFocusPending")}</span>
                    </div>
                  </header>
                  {!preview.collapsed ? (
                    <>
                      <div className="region-focus-card__crop">
                        {preview.cropDataUrl ? (
                          <img
                            alt={t("regionPromptFocusPreviewAlt", {
                              label: preview.label || t("regionPromptSummarizingLabel")
                            })}
                            src={preview.cropDataUrl}
                          />
                        ) : (
                          <span>{t("regionPromptFocusCropping")}</span>
                        )}
                      </div>
                      {preview.label ? <p className="region-focus-card__label">{preview.label}</p> : null}
                      {preview.description ? <p className="region-focus-card__description">{preview.description}</p> : null}
                      <p className="region-focus-card__precision">{preview.precision}</p>
                      <p className="region-focus-card__reference">{preview.referenceName}</p>
                    </>
                  ) : null}
                </aside>
              ))}
            </div>,
            document.body
          )
        : null}
      {regionPromptFlights.length > 0
        ? createPortal(
            <div className="region-prompt-flight-layer" aria-hidden="true">
              {regionPromptFlights.map((flight) => (
                <span
                  className="region-prompt-flight-star"
                  key={flight.id}
                  style={regionPromptFlightStyle(flight)}
                  onAnimationEnd={() => finishRegionPromptFlight(flight)}
                >
                  <Sparkles className="size-4" aria-hidden="true" />
                </span>
              ))}
            </div>,
            document.body
          )
        : null}
      {manualRegionDraft
        ? createPortal(
            <form
              className="manual-region-popover"
              style={manualRegionDraftStyle(manualRegionDraft)}
              data-testid="manual-region-popover"
              onSubmit={(event) => {
                event.preventDefault();
                confirmManualRegionDraft();
              }}
            >
              <label>
                <span>{t("regionPromptManualPopoverLabel")}</span>
                <input
                  ref={manualRegionInputRef}
                  value={manualRegionDraft.label}
                  placeholder={t("regionPromptManualPopoverPlaceholder")}
                  onChange={(event) => updateManualRegionDraftLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setManualRegionDraft(null);
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      confirmManualRegionDraft();
                    }
                  }}
                />
              </label>
              <div className="manual-region-popover__actions">
                <button className="secondary-action h-8 px-2 text-xs" type="button" onClick={() => setManualRegionDraft(null)}>
                  {t("commonCancel")}
                </button>
                <button className="primary-action h-8 px-2 text-xs" type="submit">
                  <Check className="size-3.5" aria-hidden="true" />
                  {t("regionPromptManualConfirm")}
                </button>
              </div>
            </form>,
            document.body
          )
        : null}
      {isProviderConfigDialogOpen ? (
        <Suspense fallback={null}>
          <LazyProviderConfigDialog
            initialTab={providerConfigInitialTab}
            isAuthLoading={isAuthLoading}
            isCodexStarting={codexLoginStatus === "starting"}
            mode={providerConfigDialogMode}
            onClose={closeProviderConfigDialog}
            onLogoutCodex={logoutCodexSession}
            onRefreshAgentConfig={loadAgentConfig}
            onRefreshAuthStatus={loadAuthStatus}
            onRefreshSummaryConfig={loadSummaryConfig}
            onSaved={providerConfigDialogMode === "onboarding" ? closeSavedProviderOnboarding : undefined}
            onStartCodexLogin={startCodexLogin}
          />
        </Suspense>
      ) : null}
      {route === "gallery" ? (
        <Suspense
          fallback={
            <main className="gallery-page app-view" data-testid="gallery-loading-page">
              <div className="gallery-empty-state gallery-empty-state--boot" role="status">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                <p>{t("galleryLoading")}</p>
              </div>
            </main>
          }
        >
          <LazyGalleryPage onDeleted={removeGalleryOutputFromHistory} onReuse={reuseGalleryImage} />
        </Suspense>
      ) : null}
    </div>
  );
}

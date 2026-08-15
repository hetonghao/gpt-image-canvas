import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import { AGENT_PLAN_NODE_TYPE } from "../agent/AgentPlanNodeShape";
import { GENERATION_PLACEHOLDER_TYPE } from "./GenerationPlaceholderShape";
import type {
  CanvasBounds,
  CanvasImageShape,
  CanvasShape,
  CanvasShapePartial
} from "./canvas-editor";

const BUSINESS_DATA_KEY = "ai-cove";
type ExcalidrawElementSkeleton = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number];

export function shapeSkeleton<TShape extends CanvasShape>(
  shape: CanvasShapePartial<TShape>
): ExcalidrawElementSkeleton[] {
  const x = numericProp(shape.x);
  const y = numericProp(shape.y);
  const width = numericProp(shape.props?.w, 120);
  const height = numericProp(shape.props?.h, 80);
  if (shape.type === "image") {
    const fileId = String(shape.props?.assetId ?? "") as FileId;
    return [{
      id: shape.id,
      type: "image",
      x,
      y,
      width,
      height,
      fileId,
      status: "saved",
      scale: [shape.props?.flipX ? -1 : 1, shape.props?.flipY ? -1 : 1],
      customData: businessData("image", { altText: shape.props?.altText })
    }];
  }
  const isPlaceholder = shape.type === GENERATION_PLACEHOLDER_TYPE;
  const isPlan = shape.type === AGENT_PLAN_NODE_TYPE;
  const label = isPlaceholder ? placeholderLabel(shape.props) : isPlan ? planLabel(shape.props) : undefined;
  return [{
    id: shape.id,
    type: "rectangle",
    x,
    y,
    width,
    height,
    backgroundColor: isPlaceholder ? "#f5efe6" : isPlan ? "#e2f1ee" : "transparent",
    strokeColor: isPlaceholder ? "#bb6d49" : isPlan ? "#177f7a" : "#1b1b1f",
    fillStyle: "solid",
    roundness: { type: 3 },
    label: label ? { text: label, fontSize: isPlan ? 18 : 16 } : undefined,
    customData: businessData(shape.type, shape.props ?? {})
  }];
}

export function shapeFromElement(element: ExcalidrawElement): CanvasShape {
  const data = businessDataFromElement(element);
  if (element.type === "image") {
    return {
      id: element.id,
      type: "image",
      x: element.x,
      y: element.y,
      rotation: element.angle,
      props: {
        assetId: element.fileId,
        w: element.width,
        h: element.height,
        crop: element.crop,
        flipX: element.scale[0] < 0,
        flipY: element.scale[1] < 0,
        altText: typeof data.altText === "string" ? data.altText : ""
      }
    } satisfies CanvasImageShape;
  }
  return {
    id: element.id,
    type: typeof data.kind === "string" ? data.kind : element.type,
    x: element.x,
    y: element.y,
    rotation: element.angle,
    props: { ...data, w: element.width, h: element.height }
  };
}

export function updateElement<TShape extends CanvasShape>(
  element: ExcalidrawElement,
  update: CanvasShapePartial<TShape>
): ExcalidrawElement {
  const props: Record<string, unknown> = update.props ?? {};
  const data = businessDataFromElement(element);
  return {
    ...element,
    x: typeof update.x === "number" ? update.x : element.x,
    y: typeof update.y === "number" ? update.y : element.y,
    width: typeof props.w === "number" ? props.w : element.width,
    height: typeof props.h === "number" ? props.h : element.height,
    angle: typeof update.rotation === "number" ? update.rotation : element.angle,
    version: element.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
    customData: businessData(update.type, { ...data, ...props })
  } as ExcalidrawElement;
}

export function updateImageFileStatus(
  elements: readonly ExcalidrawElement[],
  fileId: FileId,
  status: "saved" | "error"
): readonly ExcalidrawElement[] {
  let changed = false;
  const next = elements.map((element) => {
    if (element.type !== "image" || element.fileId !== fileId || element.status === status) return element;
    changed = true;
    return {
      ...element,
      status,
      version: element.version + 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
      updated: Date.now()
    };
  });
  return changed ? next : elements;
}

export function deduplicateAgentPlanNodes(elements: readonly ExcalidrawElement[]): readonly ExcalidrawElement[] {
  const planIds = new Set<string>();
  return elements.filter((element) => {
    const data = businessDataFromElement(element);
    if (data.kind !== AGENT_PLAN_NODE_TYPE || typeof data.planId !== "string") return true;
    if (planIds.has(data.planId)) return false;
    planIds.add(data.planId);
    return true;
  });
}

export function viewportState(appState: AppState) {
  return {
    zoom: appState.zoom,
    offsetLeft: appState.offsetLeft,
    offsetTop: appState.offsetTop,
    scrollX: appState.scrollX,
    scrollY: appState.scrollY
  };
}

export function canvasBounds(x: number, y: number, w: number, h: number): CanvasBounds {
  return { x, y, w, h, center: { x: x + w / 2, y: y + h / 2 } };
}

export function numericProp(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function businessData(kind: string, data: Record<string, unknown>): Record<string, unknown> {
  return { [BUSINESS_DATA_KEY]: { kind, ...data } };
}

function businessDataFromElement(element: ExcalidrawElement): Record<string, unknown> {
  const value = element.customData?.[BUSINESS_DATA_KEY];
  return isRecord(value) ? value : {};
}

function placeholderLabel(props: Record<string, unknown> | undefined): string {
  return props?.status === "failed" ? `生成失败\n${String(props.error || "请重试")}` : "正在生成图片...";
}

function planLabel(props: Record<string, unknown> | undefined): string {
  const title = typeof props?.title === "string" ? props.title : "Agent 计划";
  const status = typeof props?.status === "string" ? props.status : "awaiting_confirmation";
  const progress = typeof props?.progress === "string" ? props.progress : "0/0";
  const outputs = typeof props?.resultCount === "number" ? props.resultCount : 0;
  const failures = typeof props?.failureCount === "number" ? props.failureCount : 0;
  return `${title}\n${status} · ${progress}\n结果 ${outputs} · 失败 ${failures}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

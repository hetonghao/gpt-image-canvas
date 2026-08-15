import type { GenerationPlan } from "@gpt-image-canvas/shared";
import {
  AGENT_PLAN_NODE_TYPE,
  createAgentPlanNodeProps,
  isAgentPlanNodeShape,
  type AgentPlanNodeShape
} from "../agent/AgentPlanNodeShape";
import type {
  CanvasBounds,
  CanvasShape,
  CanvasShapePartial,
  CanvasShapeId
} from "./canvas-editor";

export interface AgentPlanCanvasEditor {
  createShapes(shapes: Array<CanvasShapePartial<AgentPlanNodeShape>>): void;
  deleteShapes(ids: CanvasShapeId[]): void;
  getCurrentPageShapes(): CanvasShape[];
  getShapePageBounds(shape: CanvasShape | CanvasShapeId): CanvasBounds | undefined;
  getViewportPageBounds(): CanvasBounds;
  select(...ids: CanvasShapeId[]): void;
  setAgentPlanRemoved(planId: string, removed: boolean): void;
  updateShapes(shapes: Array<CanvasShapePartial<AgentPlanNodeShape>>): void;
  zoomToBounds(bounds: CanvasBounds, options?: { animation?: { duration: number }; inset?: number }): void;
  zoomToSelection(options?: { animation?: { duration: number } }): void;
}

export function upsertAgentPlanNode(
  editor: AgentPlanCanvasEditor,
  plan: GenerationPlan,
  lastRunId = ""
): CanvasShapeId {
  const nodes = editor
    .getCurrentPageShapes()
    .filter((shape): shape is AgentPlanNodeShape => isAgentPlanNodeShape(shape) && shape.props.planId === plan.id);
  const props = createAgentPlanNodeProps(plan, lastRunId);
  const existing = nodes[0];
  if (existing) {
    editor.updateShapes([
      { id: existing.id, type: AGENT_PLAN_NODE_TYPE, props: { ...props } }
    ]);
    if (nodes.length > 1) editor.deleteShapes(nodes.slice(1).map((node) => node.id));
    return existing.id;
  }

  const placement = nearestOpenPlacement(editor, props.w, props.h);
  const id = `shape-${crypto.randomUUID()}`;
  editor.createShapes([
    { id, type: AGENT_PLAN_NODE_TYPE, x: placement.x, y: placement.y, props: { ...props } }
  ]);
  return id;
}

export function locateAgentPlanNode(editor: AgentPlanCanvasEditor, plan: GenerationPlan): CanvasShapeId {
  editor.setAgentPlanRemoved(plan.id, false);
  const shapeId = upsertAgentPlanNode(editor, plan);
  editor.select(shapeId);
  const bounds = editor.getShapePageBounds(shapeId);
  if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 220 }, inset: 96 });
  else editor.zoomToSelection({ animation: { duration: 220 } });
  return shapeId;
}

export function agentPlanTombstonesFromAppState(appState: unknown): Set<string> {
  if (!isRecord(appState) || !Array.isArray(appState.aiCoveRemovedAgentPlanIds)) return new Set();
  return new Set(
    appState.aiCoveRemovedAgentPlanIds.filter(
      (planId): planId is string => typeof planId === "string" && planId.length > 0
    )
  );
}

export function agentPlanTombstonesForSnapshot(planIds: ReadonlySet<string>): string[] {
  return Array.from(planIds).sort();
}

function nearestOpenPlacement(editor: AgentPlanCanvasEditor, width: number, height: number): { x: number; y: number } {
  const viewport = editor.getViewportPageBounds();
  const gap = 32;
  const origin = { x: viewport.center.x - width / 2, y: viewport.center.y - height / 2 };
  const offsets: readonly (readonly [number, number])[] = [
    [0, 0],
    [width + gap, 0],
    [-(width + gap), 0],
    [0, height + gap],
    [0, -(height + gap)]
  ];
  const occupied = editor.getCurrentPageShapes().flatMap((shape) => {
    const bounds = editor.getShapePageBounds(shape);
    return bounds ? [bounds] : [];
  });
  return offsets
    .map(([x, y]) => ({ x: origin.x + x, y: origin.y + y }))
    .find((candidate) => occupied.every((bounds) => !overlaps(candidate, width, height, bounds))) ?? origin;
}

function overlaps(point: { x: number; y: number }, width: number, height: number, bounds: CanvasBounds): boolean {
  return !(
    point.x + width <= bounds.x ||
    point.x >= bounds.x + bounds.w ||
    point.y + height <= bounds.y ||
    point.y >= bounds.y + bounds.h
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

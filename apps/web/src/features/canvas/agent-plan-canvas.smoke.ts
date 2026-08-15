import assert from "node:assert/strict";
import type { GenerationPlan } from "@gpt-image-canvas/shared";
import type { AgentPlanNodeShape } from "../agent/AgentPlanNodeShape";
import type { CanvasBounds, CanvasShape, CanvasShapeId, CanvasShapePartial } from "./canvas-editor";
import {
  agentPlanTombstonesFromAppState,
  agentPlanTombstonesForSnapshot,
  locateAgentPlanNode,
  type AgentPlanCanvasEditor,
  upsertAgentPlanNode
} from "./agent-plan-canvas";

const plan: GenerationPlan = {
  schemaVersion: 1,
  id: "plan-fixture",
  title: "Fixture plan",
  status: "awaiting_confirmation",
  defaults: { size: { width: 1024, height: 1024 }, quality: "high", outputFormat: "png" },
  jobs: [],
  edges: [],
  createdBy: "agent",
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z"
};

const shapes: CanvasShape[] = [];
const selectedIds: CanvasShapeId[] = [];
const tombstones = new Set<string>();
const zoomedBounds: CanvasBounds[] = [];
const viewport: CanvasBounds = { x: 0, y: 0, w: 1_000, h: 800, center: { x: 500, y: 400 } };

const editor: AgentPlanCanvasEditor = {
  createShapes(nextShapes: Array<CanvasShapePartial<AgentPlanNodeShape>>): void {
    for (const shape of nextShapes) {
      shapes.push({
        id: shape.id,
        type: shape.type,
        x: shape.x ?? 0,
        y: shape.y ?? 0,
        props: { ...shape.props }
      });
    }
  },
  deleteShapes(ids): void {
    const deleted = new Set(ids);
    for (let index = shapes.length - 1; index >= 0; index -= 1) {
      const shape = shapes[index];
      if (shape && deleted.has(shape.id)) shapes.splice(index, 1);
    }
  },
  getCurrentPageShapes: () => shapes,
  getShapePageBounds(shape): CanvasBounds | undefined {
    const resolved = typeof shape === "string" ? shapes.find((candidate) => candidate.id === shape) : shape;
    const width = typeof resolved?.props.w === "number" ? resolved.props.w : 0;
    const height = typeof resolved?.props.h === "number" ? resolved.props.h : 0;
    return resolved && width > 0 && height > 0
      ? { x: resolved.x, y: resolved.y, w: width, h: height, center: { x: resolved.x + width / 2, y: resolved.y + height / 2 } }
      : undefined;
  },
  getViewportPageBounds: () => viewport,
  select(...ids): void {
    selectedIds.splice(0, selectedIds.length, ...ids);
  },
  setAgentPlanRemoved(planId, removed): void {
    if (removed) tombstones.add(planId);
    else tombstones.delete(planId);
  },
  updateShapes(nextShapes): void {
    for (const update of nextShapes) {
      const shape = shapes.find((candidate) => candidate.id === update.id);
      if (!shape) continue;
      if (typeof update.x === "number") shape.x = update.x;
      if (typeof update.y === "number") shape.y = update.y;
      if (update.props) Object.assign(shape.props, update.props);
    }
  },
  zoomToBounds(bounds): void {
    zoomedBounds.push(bounds);
  },
  zoomToSelection(): void {
    throw new Error("fixture plan nodes always have bounds");
  }
};

// Given two accidental copies of one plan node.
// When the plan is upserted.
// Then only one node remains and it receives the latest summary.
const firstNodeId = upsertAgentPlanNode(editor, plan);
shapes.push({ ...shapes[0], id: "duplicate-plan-node", props: { ...shapes[0]?.props } } as CanvasShape);
const stableNodeId = upsertAgentPlanNode(editor, { ...plan, status: "running" }, "run-fixture");
assert.equal(stableNodeId, firstNodeId);
assert.equal(shapes.filter((shape) => shape.props.planId === plan.id).length, 1);
assert.equal(shapes[0]?.props.status, "running");

// Given a persisted removal tombstone and no visible node.
// When the user explicitly locates the plan.
// Then the tombstone clears, one node is selected, and the viewport locates it.
editor.deleteShapes([stableNodeId]);
tombstones.add(plan.id);
const locatedNodeId = locateAgentPlanNode(editor, plan);
assert.equal(tombstones.has(plan.id), false);
assert.deepEqual(selectedIds, [locatedNodeId]);
assert.equal(zoomedBounds.length, 1);
assert.equal(shapes.filter((shape) => shape.props.planId === plan.id).length, 1);

// Given duplicate and invalid tombstone values in saved app state.
// When the scene is restored and saved again.
// Then only sorted unique plan ids persist.
const restored = agentPlanTombstonesFromAppState({ aiCoveRemovedAgentPlanIds: ["plan-z", 42, "plan-a", "plan-z"] });
assert.deepEqual(Array.from(restored), ["plan-z", "plan-a"]);
assert.deepEqual(agentPlanTombstonesForSnapshot(restored), ["plan-a", "plan-z"]);

process.stdout.write("agent-plan-canvas.smoke.ts passed (unique + tombstone + locate + selection)\n");

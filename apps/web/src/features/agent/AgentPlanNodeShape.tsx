import type {
  GenerationDependencyEdge,
  GeneratedAsset,
  GenerationJob,
  GenerationJobRole,
  GenerationJobStatus,
  GenerationOutput,
  GenerationPlan,
  GenerationPlanStatus,
  GenerationReference,
  GenerationReferenceUsage,
  OutputStatus
} from "@gpt-image-canvas/shared";
import type { CanvasShape } from "../canvas/canvas-editor";
export const AGENT_PLAN_NODE_TYPE = "agent-plan-node" as const;
export const AGENT_PLAN_NODE_WIDTH = 360;
export const AGENT_PLAN_NODE_HEIGHT = 180;
export interface AgentPlanNodeProps {
  planId: string;
  title: string;
  status: GenerationPlanStatus;
  progress: string;
  resultCount: number;
  failureCount: number;
  lastRunId: string;
  w: number;
  h: number;
}
export interface AgentPlanNodeShape extends CanvasShape {
  type: typeof AGENT_PLAN_NODE_TYPE;
  props: CanvasShape["props"] & AgentPlanNodeProps;
}

export interface GenerationPlanOutputSummary {
  finalImageCount: number;
  supportImageCount: number;
  totalImageCount: number;
  jobCount: number;
}

const planStatuses: readonly GenerationPlanStatus[] = [
  "awaiting_confirmation",
  "confirmed",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled"
];
const jobStatuses: readonly GenerationJobStatus[] = ["queued", "running", "succeeded", "failed", "blocked", "cancelled"];
const outputStatuses: readonly OutputStatus[] = ["succeeded", "failed"];
const jobRoles: readonly GenerationJobRole[] = [
  "final_image",
  "variation",
  "character_anchor",
  "style_anchor",
  "reference_anchor"
];
const referenceUsages: readonly GenerationReferenceUsage[] = [
  "subject",
  "character",
  "style",
  "composition",
  "scene",
  "product",
  "other"
];

export function isGenerationPlan(value: unknown): value is GenerationPlan {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isOneOf(value.status, planStatuses) &&
    isRecord(value.defaults) &&
    Array.isArray(value.jobs) &&
    value.jobs.every(isGenerationJob) &&
    Array.isArray(value.edges) &&
    value.edges.every(isGenerationDependencyEdge) &&
    value.createdBy === "agent" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

export function isAgentPlanNodeShape(shape: unknown): shape is AgentPlanNodeShape {
  return isRecord(shape) && shape.type === AGENT_PLAN_NODE_TYPE && isRecord(shape.props);
}

export function isUnexecutedPlanStatus(status: GenerationPlanStatus): boolean {
  return status === "awaiting_confirmation";
}

export function isActivePlanStatus(status: GenerationPlanStatus): boolean {
  return status === "confirmed" || status === "running";
}

export function hasFailedPlanJob(plan: GenerationPlan): boolean {
  return plan.jobs.some((job) => job.status === "failed" || job.status === "blocked");
}

export function summarizeGenerationPlanOutputs(plan: GenerationPlan): GenerationPlanOutputSummary {
  return plan.jobs.reduce<GenerationPlanOutputSummary>(
    (summary, job) => {
      const count = normalizedJobOutputCount(job.count);
      if (job.role === "final_image") summary.finalImageCount += count;
      else summary.supportImageCount += count;
      summary.totalImageCount += count;
      return summary;
    },
    { finalImageCount: 0, supportImageCount: 0, totalImageCount: 0, jobCount: plan.jobs.length }
  );
}

export function generationPlanOutputCount(plan: GenerationPlan): number {
  return summarizeGenerationPlanOutputs(plan).totalImageCount;
}

export function createAgentPlanNodeProps(plan: GenerationPlan, lastRunId = ""): AgentPlanNodeProps {
  const terminalJobs = plan.jobs.filter((job) => ["succeeded", "failed", "blocked", "cancelled"].includes(job.status)).length;
  const resultCount = plan.jobs.reduce(
    (count, job) => count + job.outputs.filter((output) => output.status === "succeeded" && output.asset).length,
    0
  );
  const failedOutputs = plan.jobs.reduce(
    (count, job) => count + job.outputs.filter((output) => output.status === "failed").length,
    0
  );
  return {
    planId: plan.id,
    title: plan.title,
    status: plan.status,
    progress: `${terminalJobs}/${plan.jobs.length}`,
    resultCount,
    failureCount: failedOutputs + plan.jobs.filter((job) => job.status === "failed" || job.status === "blocked").length,
    lastRunId,
    w: AGENT_PLAN_NODE_WIDTH,
    h: AGENT_PLAN_NODE_HEIGHT
  };
}

export function normalizeAgentPlanNodePropsForSnapshot(props: unknown): AgentPlanNodeProps {
  if (!isRecord(props)) return emptyAgentPlanNodeProps();
  const status = isOneOf(props.status, planStatuses) ? props.status : "cancelled";
  return {
    planId: stringValue(props.planId),
    title: stringValue(props.title, "Agent 计划"),
    status,
    progress: stringValue(props.progress, "0/0"),
    resultCount: nonNegativeInteger(props.resultCount),
    failureCount: nonNegativeInteger(props.failureCount),
    lastRunId: stringValue(props.lastRunId),
    w: positiveNumber(props.w, AGENT_PLAN_NODE_WIDTH),
    h: positiveNumber(props.h, AGENT_PLAN_NODE_HEIGHT)
  };
}

function emptyAgentPlanNodeProps(): AgentPlanNodeProps {
  return {
    planId: "",
    title: "Agent 计划",
    status: "cancelled",
    progress: "0/0",
    resultCount: 0,
    failureCount: 0,
    lastRunId: "",
    w: AGENT_PLAN_NODE_WIDTH,
    h: AGENT_PLAN_NODE_HEIGHT
  };
}

function isGenerationReference(value: unknown): value is GenerationReference {
  if (!isRecord(value) || !isOneOf(value.usage, referenceUsages)) return false;
  if (value.kind === "selected_canvas_image") return value.assetId === undefined || typeof value.assetId === "string";
  if (value.kind === "generated_output") {
    return typeof value.jobId === "string" && (value.outputId === undefined || typeof value.outputId === "string");
  }
  return false;
}

function isGeneratedAsset(value: unknown): value is GeneratedAsset {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.fileName === "string" &&
    typeof value.mimeType === "string" &&
    positiveNumber(value.width, 0) > 0 &&
    positiveNumber(value.height, 0) > 0 &&
    (value.cloud === undefined || isRecord(value.cloud))
  );
}

function isGenerationOutput(value: unknown): value is GenerationOutput {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isOneOf(value.status, outputStatuses) &&
    (value.asset === undefined || isGeneratedAsset(value.asset)) &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isGenerationJob(value: unknown): value is GenerationJob {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isOneOf(value.role, jobRoles) &&
    typeof value.prompt === "string" &&
    typeof value.count === "number" &&
    Number.isFinite(value.count) &&
    value.count >= 0 &&
    isOneOf(value.status, jobStatuses) &&
    Array.isArray(value.references) &&
    value.references.every(isGenerationReference) &&
    Array.isArray(value.outputs) &&
    value.outputs.every(isGenerationOutput) &&
    typeof value.visible === "boolean" &&
    (value.error === undefined || typeof value.error === "string")
  );
}

function isGenerationDependencyEdge(value: unknown): value is GenerationDependencyEdge {
  return isRecord(value) && typeof value.fromJobId === "string" && typeof value.toJobId === "string";
}

function normalizedJobOutputCount(count: number): number {
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolutionTierForSize, type AgentSelectedCanvasReference, type AgentServerEvent, type GenerationPlan } from "../domain/contracts.js";
import type { EditImageProviderInput, ImageModelRoute, ImageProvider, ImageProviderInput, ProviderResult } from "../infrastructure/providers/image-provider.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `agent-executor-smoke-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

mkdirSync(dataDir, { recursive: true });

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

async function main(): Promise<void> {
  try {
    const [{ executeGenerationPlan, isExecutableGenerationPlan }, { closeDatabase, db }, imageGeneration, { parseEditPayload }, { generationRecords }] = await Promise.all([
      import("../domain/agent/executor.js"),
      import("../infrastructure/database.js"),
      import("../domain/generation/image-generation.js"),
      import("../server/http/validation.js"),
      import("../infrastructure/schema.js")
    ]);

    try {
      const successProvider = new FakeImageProvider();
      const events: AgentServerEvent[] = [];
      const success = await executeGenerationPlan({
        plan: planFixture(),
        selectedReferences: [],
        mode: "execute",
        provider: successProvider,
        requestId: "smoke-execute",
        runId: "run-smoke",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: (event) => events.push(event)
      });

      expect(success.status === "succeeded", "DAG execution succeeds");
      expect(success.plan.jobs.every((job) => job.status === "succeeded"), "all jobs are marked succeeded");
      expect(successProvider.generateCalls === 1, "anchor job uses text-to-image generation");
      expect(successProvider.editCalls === 1, "downstream generated reference uses edit generation");
      expect(events.filter((event) => event.type === "asset_preview").length === 2, "each generated asset emits a preview");

      const selectedAssetId = success.plan.jobs[0]?.outputs[0]?.asset?.id;
      expect(selectedAssetId, "successful fixture creates a stored asset for selected reference checks");
      const selectedProvider = new FakeImageProvider();
      const selectedReference = {
        id: "selected-1",
        assetId: selectedAssetId,
        label: "Selected fixture"
      } satisfies AgentSelectedCanvasReference;
      const selectedReferencePlan = selectedReferencePlanFixture(selectedAssetId);
      const selectedReferenceRun = await executeGenerationPlan({
        plan: selectedReferencePlan,
        selectedReferences: [selectedReference],
        mode: "execute",
        provider: selectedProvider,
        requestId: "smoke-selected-reference",
        runId: "run-selected-reference",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(selectedReferenceRun.status === "succeeded", "selected references resolve to stored assets");
      expect(selectedProvider.editCalls === 1, "selected reference run uses edit generation");

      const legacyAssetId = ["asset", selectedAssetId].join(":");
      const legacySelectedReferenceRun = await executeGenerationPlan({
        plan: selectedReferencePlanFixture(legacyAssetId),
        selectedReferences: [{ ...selectedReference, assetId: legacyAssetId }],
        mode: "execute",
        provider: new FakeImageProvider(),
        requestId: "smoke-legacy-selected-reference",
        runId: "run-legacy-selected-reference",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(legacySelectedReferenceRun.status === "failed", "legacy canvas asset handles are rejected");

      const localSelectedProvider = new FakeImageProvider();
      const localSelectedReference = {
        id: "selected-local-1",
        assetId: "local-only-reference",
        label: "Local canvas image",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${tinyPngBase64}`
      } satisfies AgentSelectedCanvasReference;
      const localSelectedReferenceRun = await executeGenerationPlan({
        plan: selectedReferencePlanFixture("local-only-reference"),
        selectedReferences: [localSelectedReference],
        mode: "execute",
        provider: localSelectedProvider,
        requestId: "smoke-local-selected-reference",
        runId: "run-local-selected-reference",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(localSelectedReferenceRun.status === "succeeded", "selected references with local-only asset ids are persisted before edit generation");
      expect(localSelectedProvider.editCalls === 1, "local-only selected reference run still uses edit generation");

      const multiSelectedProvider = new FakeImageProvider();
      const multiSelectedRun = await executeGenerationPlan({
        plan: multiSelectedReferencePlanFixture(),
        selectedReferences: [
          localSelectedReference,
          {
            id: "selected-local-2",
            assetId: "local-only-reference-2",
            label: "Second local canvas image",
            mimeType: "image/png",
            dataUrl: `data:image/png;base64,${tinyPngBase64}`
          }
        ],
        mode: "execute",
        provider: multiSelectedProvider,
        requestId: "smoke-multi-selected-reference",
        runId: "run-multi-selected-reference",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(multiSelectedRun.status === "succeeded", "multiple independent selected-reference jobs succeed");
      expect(multiSelectedProvider.generateCalls === 0, "multiple selected-reference jobs do not call text generation");
      expect(multiSelectedProvider.editCalls === 2, "multiple selected-reference jobs each use edit generation");

      const arbitraryCountProvider = new FakeImageProvider();
      const arbitraryCountPlan = arbitraryCountPlanFixture();
      expect(isExecutableGenerationPlan(arbitraryCountPlan), "single agent job can request an arbitrary count up to the plan cap");
      const arbitraryCountRun = await executeGenerationPlan({
        plan: arbitraryCountPlan,
        selectedReferences: [],
        mode: "execute",
        provider: arbitraryCountProvider,
        requestId: "smoke-arbitrary-count",
        runId: "run-arbitrary-count",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(arbitraryCountRun.status === "succeeded", "arbitrary-count agent job succeeds");
      expect(arbitraryCountProvider.generateCalls === 9, "arbitrary-count agent job is fanned out by the generation runner");
      expect(arbitraryCountRun.plan.jobs[0]?.outputs.length === 9, "arbitrary-count agent job preserves all outputs on one job");

      const retryProvider = new FakeImageProvider();
      const retryPlan = clonePlan(success.plan);
      const finalJob = retryPlan.jobs.find((job) => job.id === "final_scene");
      expect(finalJob, "retry fixture includes final job");
      finalJob.status = "failed";
      finalJob.outputs = [];
      finalJob.error = "retry me";
      retryPlan.status = "partial";

      const retry = await executeGenerationPlan({
        plan: retryPlan,
        selectedReferences: [],
        mode: "retry_failed",
        provider: retryProvider,
        requestId: "smoke-retry",
        runId: "run-retry",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(retry.status === "succeeded", "retry_failed recovers failed downstream job");
      expect(retryProvider.generateCalls === 0, "retry keeps succeeded upstream anchor");
      expect(retryProvider.editCalls === 1, "retry reruns failed downstream job");

      await smokeManualGenerationRecords(imageGeneration);
      await smokeStoredAssetOnlyEditPayload(imageGeneration, parseEditPayload);

      const mixedResolutionPlan = planFixture("plan-mixed-resolution");
      const oneKJob = mixedResolutionPlan.jobs[0];
      const fourKJob = mixedResolutionPlan.jobs[1];
      expect(oneKJob && fourKJob, "mixed-resolution fixture includes two jobs");
      oneKJob.prompt = "Create the independent 1K Agent fixture.";
      fourKJob.prompt = "Create the independent 4K Agent fixture.";
      fourKJob.size = { width: 3840, height: 2160 };
      fourKJob.references = [];
      mixedResolutionPlan.edges = [];
      const mixedResolutionEvents: AgentServerEvent[] = [];
      const mixedResolutionRun = await executeGenerationPlan({
        plan: mixedResolutionPlan,
        selectedReferences: [],
        mode: "execute",
        provider: new FakeImageProvider(),
        requestId: "smoke-mixed-resolution",
        runId: "run-mixed-resolution",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: (event) => mixedResolutionEvents.push(event)
      });
      const mixedResolutionRecords = mixedResolutionEvents.flatMap((event) =>
        event.type === "job_completed" && event.record ? [event.record] : []
      );
      expect(mixedResolutionRun.status === "succeeded", "mixed-resolution Agent plan succeeds");
      expect(new Set(mixedResolutionRecords.map((record) => record.id)).size === 2, "each Agent job keeps an independent generation record");
      expect(
        mixedResolutionRecords.some((record) => record.resolutionTier === "1K" && record.modelFallback === false),
        "Agent resolves the 1K model route per job"
      );
      expect(
        mixedResolutionRecords.some((record) => record.resolutionTier === "4K" && record.modelFallback === true),
        "Agent resolves the 4K model route per job"
      );

      const failedAgentPrompt = "Create the failed 4K Agent record fixture.";
      const failedAgentPlan = planFixture("plan-failed-generation-record");
      const failedAgentJob = failedAgentPlan.jobs[0];
      expect(failedAgentJob, "failed Agent fixture includes a job");
      failedAgentJob.prompt = failedAgentPrompt;
      failedAgentJob.size = { width: 3840, height: 2160 };
      failedAgentPlan.jobs = [failedAgentJob];
      failedAgentPlan.edges = [];
      let sawRunningFailedRecord = false;
      const failedAgentEvents: AgentServerEvent[] = [];
      const failedAgentRun = await executeGenerationPlan({
        plan: failedAgentPlan,
        selectedReferences: [],
        mode: "execute",
        provider: new FakeImageProvider({
          failGenerate: true,
          onGenerate: () => {
            const row = db.select().from(generationRecords).all().find((record) => record.prompt === failedAgentPrompt);
            sawRunningFailedRecord =
              row?.status === "running" &&
              row.resolutionTier === "4K" &&
              row.model === "fake-image-model" &&
              row.providerSourceId === "local-openai" &&
              row.modelFallback === 1;
          }
        }),
        requestId: "smoke-failed-generation-record",
        runId: "run-failed-generation-record",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: (event) => failedAgentEvents.push(event)
      });
      const failedAgentRow = db.select().from(generationRecords).all().find((record) => record.prompt === failedAgentPrompt);
      const failedAgentRecord = failedAgentRow ? imageGeneration.getGenerationRecord(failedAgentRow.id) : undefined;
      expect(sawRunningFailedRecord, "Agent persists the 4K model route before calling the provider");
      expect(failedAgentRun.status === "failed", "failed Agent generation reports failed");
      expect(failedAgentRecord?.status === "failed", "failed Agent generation leaves a failed generation record");
      expect(
        failedAgentRecord.error === "图像生成执行失败（内部错误）。请重试；如持续发生，请联系管理员。",
        "failed Agent generation keeps a safe unexpected-error category"
      );
      expect(failedAgentRecord.resolutionTier === "4K", "failed Agent generation keeps the requested resolution tier");
      expect(failedAgentRecord.model === "fake-image-model", "failed Agent generation keeps the resolved model");
      expect(failedAgentRecord.providerSourceId === "local-openai", "failed Agent generation keeps the provider source");
      expect(failedAgentRecord.modelFallback === true, "failed Agent generation keeps the model fallback decision");
      expect(failedAgentRun.plan.jobs[0]?.resolutionTier === "4K", "failed Agent job exposes the requested resolution tier");
      expect(failedAgentRun.plan.jobs[0]?.model === "fake-image-model", "failed Agent job exposes the resolved model");
      expect(failedAgentRun.plan.jobs[0]?.providerSourceId === "local-openai", "failed Agent job exposes the provider source");
      expect(failedAgentRun.plan.jobs[0]?.modelFallback === true, "failed Agent job exposes the fallback decision");
      expect(
        failedAgentEvents.some((event) => event.type === "job_failed" && event.record?.id === failedAgentRecord.id),
        "failed Agent event exposes its generation record"
      );

      const cancelledAgentPrompt = "Create the cancelled 4K Agent record fixture.";
      const cancelledAgentPlan = planFixture("plan-cancelled-generation-record");
      const cancelledAgentJob = cancelledAgentPlan.jobs[0];
      expect(cancelledAgentJob, "cancelled Agent fixture includes a job");
      cancelledAgentJob.prompt = cancelledAgentPrompt;
      cancelledAgentJob.size = { width: 3840, height: 2160 };
      cancelledAgentPlan.jobs = [cancelledAgentJob];
      cancelledAgentPlan.edges = [];
      const cancelController = new AbortController();
      const cancelledAgentEvents: AgentServerEvent[] = [];
      const cancelledAgentRun = await executeGenerationPlan({
        plan: cancelledAgentPlan,
        selectedReferences: [],
        mode: "execute",
        provider: new FakeImageProvider({
          onGenerate: () => {
            cancelController.abort();
            throw new DOMException("Agent smoke cancellation.", "AbortError");
          }
        }),
        requestId: "smoke-cancelled-generation-record",
        runId: "run-cancelled-generation-record",
        signal: cancelController.signal,
        isRunActive: () => true,
        sendEvent: (event) => cancelledAgentEvents.push(event)
      });
      const cancelledAgentRow = db.select().from(generationRecords).all().find((record) => record.prompt === cancelledAgentPrompt);
      const cancelledAgentRecord = cancelledAgentRow ? imageGeneration.getGenerationRecord(cancelledAgentRow.id) : undefined;
      expect(cancelledAgentRun.status === "cancelled", "cancelled Agent generation reports cancelled");
      expect(cancelledAgentRecord?.status === "cancelled", "cancelled Agent generation leaves a cancelled generation record");
      expect(cancelledAgentRecord.resolutionTier === "4K", "cancelled Agent generation keeps the requested resolution tier");
      expect(cancelledAgentRecord.model === "fake-image-model", "cancelled Agent generation keeps the resolved model");
      expect(cancelledAgentRecord.providerSourceId === "local-openai", "cancelled Agent generation keeps the provider source");
      expect(cancelledAgentRecord.modelFallback === true, "cancelled Agent generation keeps the model fallback decision");
      expect(cancelledAgentRun.plan.jobs[0]?.resolutionTier === "4K", "cancelled Agent job exposes the requested resolution tier");
      expect(cancelledAgentRun.plan.jobs[0]?.model === "fake-image-model", "cancelled Agent job exposes the resolved model");
      expect(cancelledAgentRun.plan.jobs[0]?.providerSourceId === "local-openai", "cancelled Agent job exposes the provider source");
      expect(cancelledAgentRun.plan.jobs[0]?.modelFallback === true, "cancelled Agent job exposes the fallback decision");
      expect(
        cancelledAgentEvents.some((event) => event.type === "job_cancelled" && event.record?.id === cancelledAgentRecord.id),
        "cancelled Agent event exposes its generation record"
      );

      const failedProvider = new FakeImageProvider({ failGenerate: true });
      const blocked = await executeGenerationPlan({
        plan: planFixture("plan-blocked"),
        selectedReferences: [],
        mode: "execute",
        provider: failedProvider,
        requestId: "smoke-blocked",
        runId: "run-blocked",
        signal: new AbortController().signal,
        isRunActive: () => true,
        sendEvent: () => undefined
      });
      expect(blocked.status === "failed", "failed upstream plan reports failed");
      expect(blocked.plan.jobs.find((job) => job.id === "final_scene")?.status === "blocked", "downstream job is blocked");
    } finally {
      closeDatabase();
    }

    console.log("agent executor smoke checks passed");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

class FakeImageProvider implements ImageProvider {
  readonly sourceId = "local-openai" as const;
  generateCalls = 0;
  editCalls = 0;

  constructor(
    private readonly options: {
      failGenerate?: boolean;
      onGenerate?: (input: ImageProviderInput) => void;
      retryCount?: number;
    } = {}
  ) {}

  resolveModelRoute(size: ImageProviderInput["size"]): ImageModelRoute {
    const tier = resolutionTierForSize(size);
    return {
      tier,
      model: "fake-image-model",
      fallbackToDefault: tier === "4K"
    };
  }

  async generate(input: ImageProviderInput): Promise<ProviderResult> {
    this.generateCalls += 1;
    this.options.onGenerate?.(input);
    if (this.options.failGenerate) {
      throw new Error("fake text generation failed");
    }

    return providerResult(input.sizeApiValue, this.options.retryCount);
  }

  async edit(input: EditImageProviderInput): Promise<ProviderResult> {
    this.editCalls += 1;
    expect(input.referenceImages.length > 0, "edit generation receives references");
    return providerResult(input.sizeApiValue);
  }
}

async function smokeManualGenerationRecords(imageGeneration: typeof import("../domain/generation/image-generation.js")): Promise<void> {
  const input = imageProviderInputFixture({ clientRequestId: "manual-smoke-running" });
  const running = imageGeneration.createRunningTextToImageGeneration(input);
  expect(running.id === "manual-smoke-running", "manual running generation preserves clientRequestId");
  expect(running.status === "running", "manual generation starts as running");
  expect(running.outputs.length === 0, "manual running generation has no outputs yet");
  expect(imageGeneration.getGenerationRecord(running.id)?.status === "running", "manual running generation is persisted");

  const completed = await imageGeneration.finishTextToImageGeneration(
    running.id,
    input,
    new FakeImageProvider({ retryCount: 1 }),
    new AbortController().signal
  );
  expect(completed.id === running.id, "manual generation completes the same record");
  expect(completed.status === "succeeded", "manual generation can complete asynchronously");
  expect(completed.resolutionTier === "1K", "manual generation stores the requested resolution tier");
  expect(completed.model === "fake-image-model", "manual generation stores the actual provider model");
  expect(completed.providerSourceId === "local-openai", "manual generation stores the provider source");
  expect(completed.modelFallback === false, "manual 1K generation does not report a fallback");
  expect(completed.retryCount === 1, "manual generation stores the upstream retry count");
  expect(completed.outputs.length === 1 && completed.outputs[0]?.asset, "manual generation stores the generated asset");

  const referenceInput = editImageProviderInputFixture({ clientRequestId: "manual-smoke-reference" });
  const referenceRunning = await imageGeneration.createRunningReferenceImageGeneration(referenceInput);
  expect(referenceRunning.record.id === "manual-smoke-reference", "manual reference generation preserves clientRequestId");
  expect(referenceRunning.record.mode === "edit", "manual reference generation is stored as edit mode");
  expect(referenceRunning.record.referenceAssetIds?.length === 1, "manual reference generation persists reference asset IDs");
  expect(referenceRunning.record.outputs.length === 0, "manual running reference generation has no outputs yet");

  const referenceProvider = new FakeImageProvider();
  const referenceCompleted = await imageGeneration.finishReferenceImageGeneration(
    referenceRunning.record.id,
    referenceRunning.input,
    referenceProvider,
    new AbortController().signal
  );
  expect(referenceCompleted.id === referenceRunning.record.id, "manual reference generation completes the same record");
  expect(referenceCompleted.status === "succeeded", "manual reference generation can complete asynchronously");
  expect(referenceCompleted.outputs.length === 1 && referenceCompleted.outputs[0]?.asset, "manual reference generation stores output asset");
  expect(referenceProvider.editCalls === 1, "manual reference generation calls edit provider once");

  const failedInput = imageProviderInputFixture({
    clientRequestId: "manual-smoke-failed-route",
    size: { width: 3840, height: 2160 },
    sizeApiValue: "3840x2160"
  });
  const failedRunning = imageGeneration.createRunningTextToImageGeneration(failedInput);
  const failed = await imageGeneration.finishTextToImageGeneration(
    failedRunning.id,
    failedInput,
    new FakeImageProvider({ failGenerate: true }),
    new AbortController().signal
  );
  expect(failed.status === "failed", "failed manual generation is persisted");
  expect(
    failed.error === "图像生成执行失败（内部错误）。请重试；如持续发生，请联系管理员。",
    "failed generation keeps a safe unexpected-error category"
  );
  expect(failed.resolutionTier === "4K", "failed generation keeps the requested resolution tier");
  expect(failed.model === "fake-image-model", "failed generation keeps the resolved model");
  expect(failed.providerSourceId === "local-openai", "failed generation keeps the provider source");
  expect(failed.modelFallback === true, "failed generation keeps the model fallback decision");

  const cancellable = imageGeneration.createRunningTextToImageGeneration(
    imageProviderInputFixture({ clientRequestId: "manual-smoke-cancel" })
  );
  const cancelled = imageGeneration.cancelGenerationRecord(cancellable.id);
  expect(cancelled?.status === "cancelled", "manual generation cancellation is persisted");

  const stale = imageGeneration.createRunningTextToImageGeneration(imageProviderInputFixture({ clientRequestId: "manual-smoke-stale" }));
  imageGeneration.markInterruptedGenerationRecordsFailed();
  const interrupted = imageGeneration.getGenerationRecord(stale.id);
  expect(interrupted?.status === "failed", "stale running generation is marked failed on API startup");
}

async function smokeStoredAssetOnlyEditPayload(
  imageGeneration: typeof import("../domain/generation/image-generation.js"),
  parseEditPayload: typeof import("../server/http/validation.js").parseEditPayload
): Promise<void> {
  const referenceAsset = await imageGeneration.saveReferenceImageInput({
    dataUrl: `data:image/png;base64,${tinyPngBase64}`,
    fileName: "stored-reference.png"
  });

  const parsed = parseEditPayload({
    ...editImageProviderInputFixture({ clientRequestId: "stored-asset-only" }),
    referenceImages: undefined,
    referenceImage: undefined,
    referenceAssetIds: [referenceAsset.id]
  });

  expect(parsed.ok, "edit payload accepts stored reference asset IDs without client base64 images");
  if (parsed.ok) {
    expect(parsed.value.referenceImages.length === 1, "stored reference asset IDs hydrate reference image inputs");
    expect(parsed.value.referenceImages[0]?.dataUrl.startsWith("data:image/png;base64,"), "hydrated reference keeps image data URL format");
    expect(parsed.value.referenceAssetIds?.[0] === referenceAsset.id, "stored reference asset ID is preserved");
  }
}

function imageProviderInputFixture(overrides: Partial<ImageProviderInput> = {}): ImageProviderInput {
  return {
    originalPrompt: "Create a fixture image.",
    presetId: "none",
    prompt: "Create a fixture image.",
    size: {
      width: 1024,
      height: 1024
    },
    sizeApiValue: "1024x1024",
    quality: "auto",
    outputFormat: "png",
    count: 1,
    ...overrides
  };
}

function editImageProviderInputFixture(overrides: Partial<EditImageProviderInput> = {}): EditImageProviderInput {
  return {
    ...imageProviderInputFixture(),
    referenceImages: [
      {
        dataUrl: `data:image/png;base64,${tinyPngBase64}`
      }
    ],
    ...overrides
  };
}

function providerResult(size: string, retryCount?: number): ProviderResult {
  return {
    model: "fake-image-model",
    size,
    retryCount,
    images: [
      {
        b64Json: tinyPngBase64
      }
    ]
  };
}

function planFixture(id = "plan-smoke"): GenerationPlan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    id,
    title: "Agent executor smoke plan",
    status: "awaiting_confirmation",
    defaults: {
      size: {
        width: 1024,
        height: 1024
      },
      quality: "auto",
      outputFormat: "png",
      count: 1
    },
    jobs: [
      {
        id: "character_anchor",
        role: "character_anchor",
        prompt: "Create one reusable character anchor.",
        count: 1,
        references: [],
        status: "queued",
        outputs: [],
        visible: true
      },
      {
        id: "final_scene",
        role: "final_image",
        prompt: "Create one final scene with the generated character.",
        count: 1,
        references: [
          {
            kind: "generated_output",
            usage: "character",
            jobId: "character_anchor"
          }
        ],
        status: "queued",
        outputs: [],
        visible: true
      }
    ],
    edges: [
      {
        fromJobId: "character_anchor",
        toJobId: "final_scene"
      }
    ],
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
  };
}

function selectedReferencePlanFixture(assetId: string): GenerationPlan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    id: "plan-selected-reference-smoke",
    title: "Selected reference smoke plan",
    status: "awaiting_confirmation",
    defaults: {
      size: {
        width: 1024,
        height: 1024
      },
      quality: "auto",
      outputFormat: "png",
      count: 1
    },
    jobs: [
      {
        id: "final_from_selected",
        role: "final_image",
        prompt: "Create one final image from the selected canvas reference.",
        count: 1,
        references: [
          {
            kind: "selected_canvas_image",
            usage: "style",
            assetId
          }
        ],
        status: "queued",
        outputs: [],
        visible: true
      }
    ],
    edges: [],
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
  };
}

function multiSelectedReferencePlanFixture(): GenerationPlan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    id: "plan-multi-selected-reference-smoke",
    title: "Multiple selected reference smoke plan",
    status: "awaiting_confirmation",
    defaults: {
      size: {
        width: 1024,
        height: 1024
      },
      quality: "auto",
      outputFormat: "png",
      count: 1
    },
    jobs: [
      {
        id: "caption_selected_1",
        role: "final_image",
        prompt: "Edit selected canvas image one directly and add title typography.",
        count: 1,
        references: [
          {
            kind: "selected_canvas_image",
            usage: "scene",
            assetId: "local-only-reference"
          }
        ],
        status: "queued",
        outputs: [],
        visible: true
      },
      {
        id: "caption_selected_2",
        role: "final_image",
        prompt: "Edit selected canvas image two directly and add title typography.",
        count: 1,
        references: [
          {
            kind: "selected_canvas_image",
            usage: "scene",
            assetId: "local-only-reference-2"
          }
        ],
        status: "queued",
        outputs: [],
        visible: true
      }
    ],
    edges: [],
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
  };
}

function arbitraryCountPlanFixture(): GenerationPlan {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    id: "plan-arbitrary-count-smoke",
    title: "Arbitrary count smoke plan",
    status: "awaiting_confirmation",
    defaults: {
      size: {
        width: 1024,
        height: 1024
      },
      quality: "auto",
      outputFormat: "png",
      count: 1
    },
    jobs: [
      {
        id: "travel_vlog_batch",
        role: "final_image",
        prompt: "Create nine realistic travel vlog stills.",
        count: 9,
        references: [],
        status: "queued",
        outputs: [],
        visible: true
      }
    ],
    edges: [],
    createdBy: "agent",
    createdAt: now,
    updatedAt: now
  };
}

function clonePlan(plan: GenerationPlan): GenerationPlan {
  return {
    ...plan,
    defaults: {
      ...plan.defaults,
      size: { ...plan.defaults.size }
    },
    jobs: plan.jobs.map((job) => ({
      ...job,
      size: job.size ? { ...job.size } : undefined,
      references: job.references.map((reference) => ({ ...reference })),
      outputs: job.outputs.map((output) => ({
        ...output,
        asset: output.asset ? { ...output.asset, cloud: output.asset.cloud ? { ...output.asset.cloud } : undefined } : undefined
      }))
    })),
    edges: plan.edges.map((edge) => ({ ...edge }))
  };
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

await main();

import type { GenerationRecord } from "../contracts.js";
import { createConfiguredImageProvider } from "../providers/image-provider-selection.js";
import type { EditImageProviderInput, ImageProviderInput } from "../../infrastructure/providers/image-provider.js";
import type { HostContext } from "../host/host-adapter.js";
import {
  cancelGenerationRecord,
  createRunningReferenceImageGeneration,
  createRunningTextToImageGeneration,
  failGenerationRecord,
  finishReferenceImageGeneration,
  finishTextToImageGeneration,
  getGenerationRecord,
  markInterruptedGenerationRecordsFailed
} from "./image-generation.js";

interface ActiveGenerationTask {
  controller: AbortController;
}

const activeGenerationTasks = new Map<string, ActiveGenerationTask>();

export function initializeGenerationTaskManager(): void {
  activeGenerationTasks.clear();
  markInterruptedGenerationRecordsFailed();
}

export async function startTextToImageGenerationTask(input: ImageProviderInput, hostContext?: HostContext): Promise<GenerationRecord> {
  const record = createRunningTextToImageGeneration(input, hostContext);
  if (isTerminalGenerationStatus(record.status) || activeGenerationTasks.has(generationTaskKey(record.id, hostContext))) {
    return record;
  }

  startBackgroundGenerationTask(record.id, hostContext, async (signal) => {
    const provider = await createConfiguredImageProvider(signal, hostContext);
    await finishTextToImageGeneration(record.id, input, provider, signal, hostContext);
  });

  return record;
}

export async function startReferenceImageGenerationTask(input: EditImageProviderInput, hostContext?: HostContext): Promise<GenerationRecord> {
  const running = await createRunningReferenceImageGeneration(input, hostContext);
  if (isTerminalGenerationStatus(running.record.status) || activeGenerationTasks.has(generationTaskKey(running.record.id, hostContext))) {
    return running.record;
  }

  startBackgroundGenerationTask(running.record.id, hostContext, async (signal) => {
    const provider = await createConfiguredImageProvider(signal, hostContext);
    await finishReferenceImageGeneration(running.record.id, running.input, provider, signal, hostContext);
  });

  return running.record;
}

export function readGenerationTaskRecord(generationId: string, hostContext?: HostContext): GenerationRecord | undefined {
  return getGenerationRecord(generationId, hostContext);
}

export function cancelGenerationTask(generationId: string, hostContext?: HostContext): GenerationRecord | undefined {
  const record = getGenerationRecord(generationId, hostContext);
  if (!record) {
    return undefined;
  }
  activeGenerationTasks.get(generationTaskKey(record.id, hostContext))?.controller.abort();
  return cancelGenerationRecord(record.id, hostContext);
}

function startBackgroundGenerationTask(
  generationId: string,
  hostContext: HostContext | undefined,
  run: (signal: AbortSignal) => Promise<void>
): void {
  const controller = new AbortController();
  const taskKey = generationTaskKey(generationId, hostContext);
  activeGenerationTasks.set(taskKey, { controller });

  void (async () => {
    try {
      await run(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        cancelGenerationRecord(generationId, hostContext);
      } else {
        failGenerationRecord(generationId, error, hostContext);
      }
    } finally {
      const activeTask = activeGenerationTasks.get(taskKey);
      if (activeTask?.controller === controller) {
        activeGenerationTasks.delete(taskKey);
      }
    }
  })();
}

function isTerminalGenerationStatus(status: GenerationRecord["status"]): boolean {
  return status === "succeeded" || status === "partial" || status === "failed" || status === "cancelled";
}

function generationTaskKey(generationId: string, hostContext: HostContext | undefined): string {
  return `${hostContext?.user.id ?? "standalone"}\u0000${generationId}`;
}

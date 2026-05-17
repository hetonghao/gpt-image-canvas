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

export function startTextToImageGenerationTask(input: ImageProviderInput, hostContext?: HostContext): GenerationRecord {
  const record = createRunningTextToImageGeneration(input, hostContext);
  if (isTerminalGenerationStatus(record.status) || activeGenerationTasks.has(record.id)) {
    return record;
  }

  startBackgroundGenerationTask(record.id, async (signal) => {
    const provider = await createConfiguredImageProvider(signal, hostContext);
    await finishTextToImageGeneration(record.id, input, provider, signal, hostContext);
  });

  return record;
}

export async function startReferenceImageGenerationTask(input: EditImageProviderInput, hostContext?: HostContext): Promise<GenerationRecord> {
  const running = await createRunningReferenceImageGeneration(input, hostContext);
  if (isTerminalGenerationStatus(running.record.status) || activeGenerationTasks.has(running.record.id)) {
    return running.record;
  }

  startBackgroundGenerationTask(running.record.id, async (signal) => {
    const provider = await createConfiguredImageProvider(signal, hostContext);
    await finishReferenceImageGeneration(running.record.id, running.input, provider, signal, hostContext);
  });

  return running.record;
}

export function readGenerationTaskRecord(generationId: string, hostContext?: HostContext): GenerationRecord | undefined {
  return getGenerationRecord(generationId, hostContext);
}

export function cancelGenerationTask(generationId: string, hostContext?: HostContext): GenerationRecord | undefined {
  activeGenerationTasks.get(generationId)?.controller.abort();
  return cancelGenerationRecord(generationId, hostContext);
}

function startBackgroundGenerationTask(generationId: string, run: (signal: AbortSignal) => Promise<void>): void {
  const controller = new AbortController();
  activeGenerationTasks.set(generationId, { controller });

  void (async () => {
    try {
      await run(controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        cancelGenerationRecord(generationId);
      } else {
        failGenerationRecord(generationId, errorToMessage(error));
      }
    } finally {
      const activeTask = activeGenerationTasks.get(generationId);
      if (activeTask?.controller === controller) {
        activeGenerationTasks.delete(generationId);
      }
    }
  })();
}

function isTerminalGenerationStatus(status: GenerationRecord["status"]): boolean {
  return status === "succeeded" || status === "partial" || status === "failed" || status === "cancelled";
}

function errorToMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Generation failed. Try again.";
}

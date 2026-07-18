import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerationRecord } from "../domain/contracts.js";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-generation-task-"));
const originalFetch = globalThis.fetch;
process.env.DATA_DIR = dataDir;
process.env.HOST_ADAPTER = "ai-cove-new-api";
process.env.AI_COVE_API_BASE_URL = "https://new-api.example";
process.env.AI_COVE_PUBLIC_BASE_URL = "https://public.example";
delete process.env.OPENAI_API_KEY;

try {
  const { cancelGenerationTask, readGenerationTaskRecord, startTextToImageGenerationTask } = await import(
    "../domain/generation/generation-tasks.js"
  );
  const [{ db }, { providerConfigs }] = await Promise.all([
    import("../infrastructure/database.js"),
    import("../infrastructure/schema.js")
  ]);
  const hostContext = {
    token: "host-token",
    userId: "42",
    user: {
      id: "42",
      displayName: "Ada",
      email: "ada@example.com"
    }
  };
  const clientRequestId = "host-generation-provider-failure";

  // Given: a hosted user starts generation while no provider is configured.
  await startTextToImageGenerationTask(
    {
      clientRequestId,
      originalPrompt: "draw a calm workstation",
      presetId: "none",
      prompt: "draw a calm workstation",
      size: { width: 3840, height: 2160 },
      sizeApiValue: "3840x2160",
      quality: "high",
      outputFormat: "png",
      count: 1
    },
    hostContext
  );

  // When: provider resolution fails in the background task.
  const record = await waitForTerminalRecord(() => readGenerationTaskRecord(clientRequestId, hostContext));

  // Then: the same hosted user's record becomes inspectably failed instead of staying running.
  expect(record?.status === "failed", `status = ${record?.status ?? "missing"}`);
  expect(Boolean(record?.error), "failed hosted generation keeps a safe error reason");
  expect(readGenerationTaskRecord(clientRequestId) === undefined, "the record is not written to the standalone user scope");

  // Given: provider credential resolution is waiting on the hosted gateway.
  const now = new Date().toISOString();
  db.insert(providerConfigs)
    .values({
      id: `${hostContext.user.id}:active`,
      userId: hostContext.user.id,
      sourceOrderJson: JSON.stringify(["local-openai", "env-openai", "codex"]),
      localApiKey: null,
      localApiKeyId: "7",
      localBaseUrl: "https://public.example/v1",
      localModel: "gpt-image-2",
      localModel2K: "gpt-image-2-hd",
      localModel4K: "gpt-image-2-ultra",
      localTimeoutMs: 1200000,
      createdAt: now,
      updatedAt: now
    })
    .run();
  let markProviderResolutionStarted: (() => void) | undefined;
  let releaseProviderResolution: (() => void) | undefined;
  let providerResolutionAbortCount = 0;
  const providerResolutionStarted = new Promise<void>((resolve) => {
    markProviderResolutionStarted = resolve;
  });
  globalThis.fetch = async (input, init): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname === "/api/token/") {
      return json({
        success: true,
        data: {
          items: [{ id: 7, name: "Design key", status: 1, group: "default", key: "sk-test********key" }]
        }
      });
    }
    if (url.pathname === "/api/token/7/key") {
      markProviderResolutionStarted?.();
      return await new Promise<Response>((resolve, reject) => {
        releaseProviderResolution = () => resolve(json({ success: true, data: { key: "sk-real-key" } }));
        const abort = (): void => {
          providerResolutionAbortCount += 1;
          reject(new DOMException("cancelled", "AbortError"));
        };
        if (init?.signal?.aborted) {
          abort();
          return;
        }
        init?.signal?.addEventListener("abort", abort, { once: true });
      });
    }
    return await new Promise<Response>((_resolve, reject) => {
      const abort = (): void => reject(new DOMException("cancelled", "AbortError"));
      if (init?.signal?.aborted) {
        abort();
        return;
      }
      init?.signal?.addEventListener("abort", abort, { once: true });
    });
  };
  const cancellationRequestId = "host-generation-provider-resolution-cancel";
  const pendingStart = startTextToImageGenerationTask(
    {
      clientRequestId: cancellationRequestId,
      originalPrompt: "draw a cancellable high-resolution workstation",
      presetId: "none",
      prompt: "draw a cancellable high-resolution workstation",
      size: { width: 3840, height: 2160 },
      sizeApiValue: "3840x2160",
      quality: "high",
      outputFormat: "png",
      count: 1
    },
    hostContext
  );
  await providerResolutionStarted;

  // When: the same user cancels while provider resolution is still pending.
  const cancelledDuringResolution = cancelGenerationTask(cancellationRequestId, hostContext);
  if (!cancelledDuringResolution) {
    releaseProviderResolution?.();
  }
  const startedRecord = await pendingStart;
  if (!cancelledDuringResolution) {
    cancelGenerationTask(startedRecord.id, hostContext);
  }

  // Then: the pre-registered record and provider resolution share one abort signal.
  expect(cancelledDuringResolution?.status === "cancelled", "provider resolution can be cancelled through the generation task record");
  expect(providerResolutionAbortCount === 1, "provider resolution receives the generation task abort signal");
  expect(cancelledDuringResolution.resolutionTier === "4K", "cancelled provider resolution keeps the requested resolution tier");
  console.log("generation-task-host-context.smoke.ts passed");
} finally {
  globalThis.fetch = originalFetch;
  rmSync(dataDir, { force: true, recursive: true });
}

async function waitForTerminalRecord(read: () => GenerationRecord | undefined): Promise<GenerationRecord | undefined> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const record = read();
    if (record && record.status !== "running") {
      return record;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  return read();
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

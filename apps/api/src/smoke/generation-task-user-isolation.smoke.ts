import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerationRecord } from "../domain/contracts.js";
import type { HostContext } from "../domain/host/host-adapter.js";
import type { ImageProviderInput } from "../infrastructure/providers/image-provider.js";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-generation-user-isolation-"));
const originalFetch = globalThis.fetch;
process.env.DATA_DIR = dataDir;
process.env.OPENAI_API_KEY = "test-key";
process.env.OPENAI_BASE_URL = "https://api.ai-cove.com/v1";
process.env.OPENAI_IMAGE_MODEL = "test-image-model";

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=";
const sharedRequestId = "shared-client-request";

async function main(): Promise<void> {
  const generationTasks = await import("../domain/generation/generation-tasks.js");
  const imageGeneration = await import("../domain/generation/image-generation.js");
  const [{ closeDatabase, db }, { generationRecords }] = await Promise.all([
    import("../infrastructure/database.js"),
    import("../infrastructure/schema.js")
  ]);
  const userA = hostContext("user-a", "Ada");
  const userB = hostContext("user-b", "Grace");
  let markUserAStarted: (() => void) | undefined;
  let userAAbortCount = 0;
  const userAStarted = new Promise<void>((resolve) => {
    markUserAStarted = resolve;
  });

  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    const prompt = request && typeof request === "object" && "prompt" in request ? request.prompt : undefined;
    if (prompt === "user A generation") {
      markUserAStarted?.();
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          userAAbortCount += 1;
          reject(new DOMException("cancelled", "AbortError"));
        }, { once: true });
      });
    }
    return new Response(JSON.stringify({ data: [{ b64_json: tinyPngBase64 }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    // Given: user A has a running request and user B submits the same public client request id.
    const recordA = await generationTasks.startTextToImageGenerationTask(imageInput(sharedRequestId, "user A generation"), userA);
    await userAStarted;
    const unauthorizedCancellation = generationTasks.cancelGenerationTask(recordA.id, userB);
    const abortCountAfterUnauthorizedCancellation = userAAbortCount;
    const recordB = await generationTasks.startTextToImageGenerationTask(imageInput(sharedRequestId, "user B generation"), userB);
    const storedRows = db.select().from(generationRecords).all().filter((record) => record.clientRequestId === sharedRequestId);
    // When: user A cancels by the shared public request id.
    const cancelledA = generationTasks.cancelGenerationTask(sharedRequestId, userA);
    const completedB = await waitForTerminalRecord(() => generationTasks.readGenerationTaskRecord(recordB.id, userB));
    // Then: database rows, task controllers and cancellation remain isolated by hosted user.
    expect(unauthorizedCancellation === undefined, "user B cannot resolve user A's generation id");
    expect(abortCountAfterUnauthorizedCancellation === 0, "user B cannot abort user A's provider request");
    expect(recordA.id === sharedRequestId && recordB.id === sharedRequestId, "hosted generation keeps the client request id contract");
    expect(storedRows.length === 2, "both hosted users persist the shared client request id");
    expect(new Set(storedRows.map((record) => record.id)).size === 2, "hosted users receive distinct database primary keys");
    expect(userAAbortCount === 1, "only user A's authorized cancellation aborts user A's provider request");
    expect(cancelledA?.status === "cancelled", `user A status = ${cancelledA?.status ?? "missing"}`);
    expect(cancelledA?.model === "test-image-model", `cancelled model = ${cancelledA?.model ?? "missing"}`);
    expect(cancelledA?.providerSourceId === "env-openai", `cancelled source = ${cancelledA?.providerSourceId ?? "missing"}`);
    expect(cancelledA?.modelFallback === false, `cancelled fallback = ${String(cancelledA?.modelFallback)}`);
    expect(completedB?.status === "succeeded", `user B status = ${completedB?.status ?? "missing"}`);
    expect(generationTasks.readGenerationTaskRecord(sharedRequestId, userB)?.id === recordB.id, "user B resolves its own request");
    expect(generationTasks.readGenerationTaskRecord(sharedRequestId) === undefined, "hosted records do not leak into standalone scope");
    const userAStorageId = storedRows.find((record) => record.userId === userA.user.id)?.id;
    expect(userAStorageId, "user A storage id is available for collision coverage");
    smokeClientAliasPriority(imageGeneration, userAStorageId, userA);
    process.stdout.write("generation-task-user-isolation.smoke.ts passed\n");
  } finally {
    closeDatabase();
    globalThis.fetch = originalFetch;
    rmSync(dataDir, { force: true, recursive: true });
  }
}

function smokeClientAliasPriority(
  imageGeneration: typeof import("../domain/generation/image-generation.js"),
  existingStorageId: string,
  host: HostContext
): void {
  // Given: a client request id matches another hosted record's internal storage id.
  const collision = imageGeneration.createRunningTextToImageGeneration(imageInput(existingStorageId, "client alias wins"), host);
  // When: the public id is read through the normal generation lookup.
  const resolved = imageGeneration.getGenerationRecord(existingStorageId, host);
  const originalRetry = imageGeneration.createRunningTextToImageGeneration(imageInput(sharedRequestId, "must stay idempotent"), host);
  // Then: the client request alias wins deterministically over the hidden storage id.
  expect(collision.effectivePrompt === "client alias wins", "colliding client request creates its own record");
  expect(resolved?.effectivePrompt === "client alias wins", "public client request lookup wins over internal storage id");
  expect(originalRetry.effectivePrompt === "user A generation", "original client request id remains idempotent after collision");
  imageGeneration.cancelGenerationRecord(collision.id, host);
}

function imageInput(clientRequestId: string, prompt: string): ImageProviderInput {
  return {
    clientRequestId,
    originalPrompt: prompt,
    presetId: "none",
    prompt,
    size: { width: 1024, height: 1024 },
    sizeApiValue: "1024x1024",
    quality: "high",
    outputFormat: "png",
    count: 1
  };
}

function hostContext(id: string, displayName: string): HostContext {
  return { token: `token-${id}`, userId: id, user: { id, displayName } };
}

async function waitForTerminalRecord(read: () => GenerationRecord | undefined): Promise<GenerationRecord | undefined> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
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

await main();

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type {
  EditImageProviderInput,
  ImageProvider,
  ImageProviderInput,
  ProviderResult
} from "../infrastructure/providers/image-provider.js";

const dataDir = mkdtempSync(join(tmpdir(), "gpt-image-canvas-generation-safety-"));
process.env.DATA_DIR = dataDir;
prepareLegacyDatabase();

async function main(): Promise<void> {
  const imageGeneration = await import("../domain/generation/image-generation.js");
  const projectStore = await import("../domain/project/project-store.js");
  const { closeDatabase, db } = await import("../infrastructure/database.js");
  const { assets } = await import("../infrastructure/schema.js");

  try {
    smokeLegacySchemaMigration(imageGeneration);
    smokeProjectHistoryRoute(imageGeneration, projectStore);
    await smokeSafeUnexpectedFailure(imageGeneration);
    await smokeReferenceGenerationIdempotency(imageGeneration, db, assets);
    smokeInterruptedRoute(imageGeneration);
    process.stdout.write("generation-record-safety.smoke.ts passed\n");
  } finally {
    closeDatabase();
    rmSync(dataDir, { force: true, recursive: true });
  }
}

async function smokeReferenceGenerationIdempotency(
  imageGeneration: typeof import("../domain/generation/image-generation.js"),
  db: typeof import("../infrastructure/database.js").db,
  assets: typeof import("../infrastructure/schema.js").assets
): Promise<void> {
  const input: EditImageProviderInput = {
    ...imageInput("reference-idempotency", "reference idempotency"),
    referenceImages: [
      {
        dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
      }
    ]
  };
  const assetCountBefore = db.select({ id: assets.id }).from(assets).all().length;

  const [first, retry] = await Promise.all([
    imageGeneration.createRunningReferenceImageGeneration(input),
    imageGeneration.createRunningReferenceImageGeneration(input)
  ]);
  const assetCountAfter = db.select({ id: assets.id }).from(assets).all().length;

  expect(first.record.id === retry.record.id, "concurrent reference retries resolve to one generation record");
  expect(assetCountAfter === assetCountBefore + 1, "concurrent reference retries persist one reference asset");

  const persistedRetry = await imageGeneration.createRunningReferenceImageGeneration(input);
  const assetCountAfterPersistedRetry = db.select({ id: assets.id }).from(assets).all().length;
  expect(persistedRetry.record.id === first.record.id, "persisted reference retry resolves to the original generation record");
  expect(assetCountAfterPersistedRetry === assetCountAfter, "persisted reference retry does not create another reference asset");
}

function smokeProjectHistoryRoute(
  imageGeneration: typeof import("../domain/generation/image-generation.js"),
  projectStore: typeof import("../domain/project/project-store.js")
): void {
  const hostContext = { user: { id: "project-history-user", displayName: "Project History User" } };
  const input = { ...imageInput("project-history-client", "project history route"), size: { width: 3840, height: 2160 }, sizeApiValue: "3840x2160" };
  const running = imageGeneration.createRunningTextToImageGeneration(input, hostContext, new RoutedImageProvider());
  imageGeneration.failGenerationRecord(running.id, "project history fixture", hostContext);

  const historyRecord = projectStore.getProjectState(hostContext).history[0];
  expect(historyRecord?.id === "project-history-client", `project history public id = ${historyRecord?.id ?? "missing"}`);
  expect(historyRecord?.resolutionTier === "4K", `project history tier = ${historyRecord?.resolutionTier ?? "missing"}`);
  expect(historyRecord?.model === "fixture-default-model", `project history model = ${historyRecord?.model ?? "missing"}`);
  expect(historyRecord?.providerSourceId === "local-openai", `project history source = ${historyRecord?.providerSourceId ?? "missing"}`);
  expect(historyRecord?.modelFallback === true, `project history fallback = ${String(historyRecord?.modelFallback)}`);
}

function smokeInterruptedRoute(
  imageGeneration: typeof import("../domain/generation/image-generation.js")
): void {
  // Given: provider routing is known before a long-running 4K upstream request begins.
  const input = { ...imageInput("interrupted-route", "interrupted route"), size: { width: 3840, height: 2160 }, sizeApiValue: "3840x2160" };
  const running = imageGeneration.createRunningTextToImageGeneration(input, undefined, new RoutedImageProvider());
  // When: service startup recovery marks the still-running record as interrupted.
  imageGeneration.markInterruptedGenerationRecordsFailed();
  const interrupted = imageGeneration.getGenerationRecord(running.id);
  // Then: the interrupted history retains the route selected before upstream execution.
  expect(interrupted?.status === "failed", `interrupted status = ${interrupted?.status ?? "missing"}`);
  expect(interrupted?.resolutionTier === "4K", `interrupted tier = ${interrupted?.resolutionTier ?? "missing"}`);
  expect(interrupted?.model === "fixture-default-model", `interrupted model = ${interrupted?.model ?? "missing"}`);
  expect(interrupted?.providerSourceId === "local-openai", `interrupted source = ${interrupted?.providerSourceId ?? "missing"}`);
  expect(interrupted?.modelFallback === true, `interrupted fallback = ${String(interrupted?.modelFallback)}`);
}

function smokeLegacySchemaMigration(
  imageGeneration: typeof import("../domain/generation/image-generation.js")
): void {
  const legacyHost = { user: { id: "legacy-user", displayName: "Legacy User" } };
  // Given: startup opened a hosted generation table created before client request scoping existed.
  // When: the current schema migration backfills the request id and creates its unique user index.
  const legacy = imageGeneration.getGenerationRecord("legacy-generation", legacyHost);
  const standaloneRetry = imageGeneration.createRunningTextToImageGeneration(imageInput("legacy-standalone", "retry"));
  const inspector = new Database(join(dataDir, "gpt-image-canvas.sqlite"), { readonly: true });
  const indexes: unknown = inspector.pragma("index_list('generation_records')");
  const indexColumns: unknown = inspector.pragma("index_info('generation_records_user_client_request_idx')");
  const row: unknown = inspector.prepare("SELECT client_request_id FROM generation_records WHERE id = ?").get("legacy-generation");
  inspector.close();
  const userRequestIndex = Array.isArray(indexes)
    ? indexes.find((index) => index && typeof index === "object" && "name" in index && index.name === "generation_records_user_client_request_idx")
    : undefined;
  const isUniqueIndex = userRequestIndex && typeof userRequestIndex === "object" && "unique" in userRequestIndex && userRequestIndex.unique === 1;
  const indexedColumnNames = Array.isArray(indexColumns)
    ? indexColumns.flatMap((column) => column && typeof column === "object" && "name" in column && typeof column.name === "string" ? [column.name] : [])
    : [];
  const backfilledRequestId = row && typeof row === "object" && "client_request_id" in row ? row.client_request_id : undefined;
  // Then: the old hosted generation remains readable through its preserved public request id.
  expect(legacy?.id === "legacy-generation", "legacy hosted generation remains readable after migration");
  expect(standaloneRetry.effectivePrompt === "legacy", "legacy standalone request id remains idempotent after migration");
  expect(backfilledRequestId === "legacy-generation", "legacy hosted generation request id is backfilled");
  expect(isUniqueIndex, "legacy migration creates a unique hosted user request index");
  expect(indexedColumnNames.join(",") === "user_id,client_request_id", "hosted request index uses user id then client request id");
}

async function smokeSafeUnexpectedFailure(
  imageGeneration: typeof import("../domain/generation/image-generation.js")
): Promise<void> {
  const { ProviderError } = await import("../infrastructure/providers/image-provider.js");
  // Given: unexpected typed and untyped provider failures contain credentials, an internal URL and response text.
  const untypedInput = imageInput("unsafe-provider-error", "unsafe provider error");
  const untypedRunning = imageGeneration.createRunningTextToImageGeneration(untypedInput);
  // When: the failures are persisted to generation history.
  const untypedFailure = await imageGeneration.finishTextToImageGeneration(
    untypedRunning.id,
    untypedInput,
    new UnsafeImageProvider(),
    new AbortController().signal
  );
  const typedInput = imageInput("unsafe-provider-error-typed", "unsafe typed provider error");
  const typedRunning = imageGeneration.createRunningTextToImageGeneration(typedInput);
  const typedFailure = await imageGeneration.finishTextToImageGeneration(
    typedRunning.id,
    typedInput,
    new UnsafeImageProvider(
      new ProviderError("upstream_failure", "Bearer secret-token http://127.0.0.1/private private response body", 502, 1)
    ),
    new AbortController().signal
  );
  // Then: history keeps stable categories without persisting either unsafe original message.
  expect(
    untypedFailure.error === "图像生成执行失败（内部错误）。请重试；如持续发生，请联系管理员。",
    `unexpected failure reason = ${untypedFailure.error ?? "missing"}`
  );
  expect(
    typedFailure.error === "图像生成服务请求失败（HTTP 502）。请稍后重试。",
    `typed provider failure reason = ${typedFailure.error ?? "missing"}`
  );
  expect(typedFailure.retryCount === 1, `typed provider retry count = ${String(typedFailure.retryCount)}`);
  const history = JSON.stringify([untypedFailure, typedFailure]);
  expect(!history.includes("secret-token"), "generation history does not contain the provider token");
  expect(!history.includes("127.0.0.1"), "generation history does not contain the internal URL");
  expect(!history.includes("private response body"), "generation history does not contain the upstream response body");
}

class UnsafeImageProvider implements ImageProvider {
  constructor(
    private readonly failure: Error = new Error("Bearer secret-token http://127.0.0.1/private private response body")
  ) {}

  async generate(_input: ImageProviderInput): Promise<ProviderResult> {
    throw this.failure;
  }

  async edit(_input: EditImageProviderInput): Promise<ProviderResult> {
    throw this.failure;
  }
}

class RoutedImageProvider implements ImageProvider {
  readonly sourceId = "local-openai" as const;

  resolveModelRoute(): { tier: "4K"; model: string; fallbackToDefault: true } {
    return { tier: "4K", model: "fixture-default-model", fallbackToDefault: true };
  }

  async generate(): Promise<ProviderResult> {
    throw new Error("The interrupted-route smoke never calls the provider.");
  }

  async edit(): Promise<ProviderResult> {
    throw new Error("The interrupted-route smoke never calls the provider.");
  }
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

function prepareLegacyDatabase(): void {
  const database = new Database(join(dataDir, "gpt-image-canvas.sqlite"));
  database.exec(`
    CREATE TABLE generation_records (
      id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL DEFAULT 'standalone', mode TEXT NOT NULL,
      prompt TEXT NOT NULL, effective_prompt TEXT NOT NULL, preset_id TEXT NOT NULL,
      width INTEGER NOT NULL, height INTEGER NOT NULL, quality TEXT NOT NULL, output_format TEXT NOT NULL,
      count INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, reference_asset_id TEXT, created_at TEXT NOT NULL
    );
    INSERT INTO generation_records (
      id, user_id, mode, prompt, effective_prompt, preset_id, width, height, quality, output_format, count, status, created_at
    ) VALUES (
      'legacy-generation', 'legacy-user', 'generate', 'legacy', 'legacy', 'none',
      1024, 1024, 'high', 'png', 1, 'failed', '2026-07-13T00:00:00.000Z'
    ), (
      'legacy-standalone', 'standalone', 'generate', 'legacy', 'legacy', 'none',
      1024, 1024, 'high', 'png', 1, 'failed', '2026-07-13T00:00:00.000Z'
    );
  `);
  database.close();
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

await main();

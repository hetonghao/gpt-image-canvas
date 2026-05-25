import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const dataDir = resolve(repoRoot, ".codex-temp", `region-summary-smoke-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = dataDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

mkdirSync(dataDir, { recursive: true });

async function main(): Promise<void> {
  try {
    const [{ app }, { closeDatabase }, summaryConfig, regionSummary] = await Promise.all([
      import("../index.js"),
      import("../infrastructure/database.js"),
      import("../domain/summary/config.js"),
      import("../domain/summary/region-summary.js")
    ]);

    try {
      await smokeSummaryConfig(app);
      await smokeRegionSummaryValidation(app);
      await smokeRegionSummaryUpstreamError(app, summaryConfig);
      smokeRegionSummaryFailureClassification(regionSummary.regionSummaryFailureCode);
      smokeRegionSummaryNormalization(regionSummary.normalizeRegionSummaryResponse);
      await smokeSummaryConfigPriority(summaryConfig, regionSummary.resolveRegionSummaryModelConfig);
    } finally {
      closeDatabase();
    }

    process.stdout.write("region-summary.smoke.ts passed\n");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function smokeSummaryConfig(app: RequestApp): Promise<void> {
  const initial = await requestJson(app, "/api/summary-config");
  assert.equal(initial.response.status, 200, "initial Summary config GET returns 200");
  assert.equal(initial.body.configured, false, "initial Summary config is optional and unconfigured");
  assert.equal(initial.body.supportsVision, true, "initial Summary supportsVision defaults to true");

  const invalidTimeout = await requestJson(app, "/api/summary-config", {
    method: "PUT",
    body: {
      apiKey: "sk-summary",
      baseUrl: "",
      model: "gemini-2.5-flash",
      timeoutMs: 0,
      supportsVision: true
    }
  });
  assert.equal(invalidTimeout.response.status, 400, "invalid Summary timeout is rejected");

  const saved = await requestJson(app, "/api/summary-config", {
    method: "PUT",
    body: {
      apiKey: "  sk-summary-secret  ",
      baseUrl: "  https://summary.example.test/v1  ",
      model: "  gemini-2.5-flash  ",
      timeoutMs: 18000,
      supportsVision: true
    }
  });
  assert.equal(saved.response.status, 200, "valid Summary config save returns 200");
  assert.equal(saved.body.configured, true, "saved Summary config is configured");
  assert.equal(saved.body.baseUrl, "https://summary.example.test/v1", "Summary base URL is trimmed");
  assert.equal(saved.body.model, "gemini-2.5-flash", "Summary model is trimmed");
  assert.equal(saved.body.supportsVision, true, "Summary vision flag is saved");
  assert.equal(JSON.stringify(saved.body).includes("sk-summary-secret"), false, "Summary config readback masks API key");

  const cleared = await requestJson(app, "/api/summary-config", {
    method: "PUT",
    body: {
      apiKey: "",
      baseUrl: "",
      model: "",
      timeoutMs: 60000,
      supportsVision: true
    }
  });
  assert.equal(cleared.response.status, 200, "empty Summary config save clears optional config");
  assert.equal(cleared.body.configured, false, "cleared Summary config is not configured");
}

async function smokeRegionSummaryValidation(app: RequestApp): Promise<void> {
  const invalid = await requestJson(app, "/api/images/region-summary", {
    method: "POST",
    body: {
      image: { dataUrl: "data:text/plain;base64,SGVsbG8=" },
      source: { width: 100, height: 100 },
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
      locale: "zh-CN"
    }
  });
  assert.equal(invalid.response.status, 400, "invalid image MIME type is rejected");
  assert.equal(invalid.body.error.code, "invalid_region_summary_request", "invalid summary payload uses stable code");
}

async function smokeRegionSummaryUpstreamError(
  app: RequestApp,
  config: typeof import("../domain/summary/config.js")
): Promise<void> {
  await config.saveSummaryLlmConfig({
    apiKey: "sk-invalid-summary",
    baseUrl: "https://summary.example.test/v1",
    model: "gemini-2.5-flash",
    timeoutMs: 18000,
    supportsVision: true
  });

  const failed = await requestJson(app, "/api/images/region-summary", {
    method: "POST",
    body: {
      image: { dataUrl: "data:image/png;base64,iVBORw0KGgo=", fileName: "region.png" },
      source: { width: 100, height: 100 },
      region: { x: 0, y: 0, width: 0.5, height: 0.5 },
      locale: "zh-CN"
    }
  });

  assert.equal(failed.response.status, 502, "summary upstream failures return a gateway error");
  assert.equal(failed.body.error.code, "region_summary_failed", "summary upstream failures use a user-facing stable code");
  assert.equal(failed.body.error.message.includes("langchain"), false, "summary upstream failure does not expose provider debug URLs");
  assert.equal(failed.body.error.message.includes("request id"), false, "summary upstream failure does not expose provider request ids");

  await config.saveSummaryLlmConfig({
    apiKey: "",
    baseUrl: "",
    model: "",
    timeoutMs: 60000,
    supportsVision: true
  });
}

function smokeRegionSummaryFailureClassification(
  classify: typeof import("../domain/summary/region-summary.js").regionSummaryFailureCode
): void {
  assert.equal(
    classify(new Error("401 Invalid token (request id: 202605241715016907816388) Troubleshooting URL: https://docs.langchain.com/oss/javascript/langchain/errors")),
    "region_summary_auth_failed",
    "401 invalid token failures are classified as Summary LLM authentication failures"
  );
  assert.equal(classify(new Error("Connection error.")), "region_summary_failed", "generic upstream failures stay generic");
}

function smokeRegionSummaryNormalization(
  normalize: typeof import("../domain/summary/region-summary.js").normalizeRegionSummaryResponse
): void {
  assert.deepEqual(
    normalize('{"label":"红色连衣裙","description":"人物身上的红色无袖连衣裙，位于画面中央"}', "zh-CN"),
    { label: "红色连衣裙", description: "人物身上的红色无袖连衣裙，位于画面中央" },
    "JSON model output is normalized"
  );
  assert.deepEqual(
    normalize("red sleeveless dress on person", "en"),
    { label: "red sleeveless dress on person", description: "" },
    "plain text model output becomes editable label"
  );
}

async function smokeSummaryConfigPriority(
  config: typeof import("../domain/summary/config.js"),
  resolveModelConfig: typeof import("../domain/summary/region-summary.js").resolveRegionSummaryModelConfig
): Promise<void> {
  const missing = await resolveModelConfig();
  assert.equal(missing.ok, false, "missing Summary and Agent config rejects summary");
  if (!missing.ok) {
    assert.equal(missing.code, "missing_region_summary_config", "missing config uses stable code");
  }

  await config.saveSummaryLlmConfig({
    apiKey: "sk-summary-secret",
    baseUrl: "https://summary.example.test/v1",
    model: "gemini-2.5-flash",
    timeoutMs: 18000,
    supportsVision: false
  });

  const noVision = await resolveModelConfig();
  assert.equal(noVision.ok, false, "configured non-vision Summary config does not fall back");
  if (!noVision.ok) {
    assert.equal(noVision.code, "summary_llm_requires_vision", "non-vision Summary config uses stable code");
  }
}

interface RequestApp {
  fetch(request: Request): Response | Promise<Response>;
}

async function requestJson(app: RequestApp, path: string, options: { method?: string; body?: unknown } = {}): Promise<{ response: Response; body: any }> {
  const response = await app.fetch(
    new Request(`http://127.0.0.1${path}`, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    })
  );
  return { response, body: await response.json() };
}

void main();

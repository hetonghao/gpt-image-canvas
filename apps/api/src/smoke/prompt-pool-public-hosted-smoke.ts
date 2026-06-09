import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = join(tmpdir(), `gpt-image-canvas-prompt-pool-public-data-${process.pid}-${Date.now()}`);
const promptPoolDir = join(tmpdir(), `gpt-image-canvas-prompt-pool-public-pool-${process.pid}-${Date.now()}`);

process.env.DATA_DIR = dataDir;
process.env.PROMPT_POOL_DIR = promptPoolDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";
process.env.HOST_ADAPTER = "ai-cove-new-api";
process.env.AI_COVE_API_BASE_URL = "https://new-api.example";

mkdirSync(dataDir, { recursive: true });
mkdirSync(promptPoolDir, { recursive: true });
writeFileSync(
  join(promptPoolDir, "summary.json"),
  JSON.stringify({
    rawBase: "https://raw.githubusercontent.com/mrslimslim/awesome-prompt/main",
    promptCount: 1,
    imagePromptCount: 1,
    videoPromptCount: 0,
    assetCount: 1
  })
);
writeFileSync(
  join(promptPoolDir, "prompts-all.json"),
  JSON.stringify([
    {
      id: "public-prompt",
      title: "Public prompt",
      prompt: "Create a quiet product study.",
      mediaType: "image",
      model: "GPT Image",
      promptReady: true,
      localImages: ["images/public-prompt/0.webp"],
      stats: {
        likes: 3,
        views: 18,
        retweets: 0
      }
    }
  ])
);

try {
  const [{ app }, { closeDatabase }] = await Promise.all([
    import("../index.js"),
    import("../infrastructure/database.js")
  ]);

  const pool = await requestJson(app, "/api/pool?limit=1");
  expect(pool.response.status === 200, "Prompt Pool list stays public in hosted desktop mode");
  expect(pool.body.available === true, "Prompt Pool list remains available");
  expect(Array.isArray(pool.body.items), "Prompt Pool list includes items");
  expect(pool.body.items.length === 1, "Prompt Pool public list returns bundled prompts");

  const detail = await requestJson(app, "/api/pool/public-prompt");
  expect(detail.response.status === 200, "Prompt Pool detail stays public in hosted desktop mode");
  expect(isRecord(detail.body.item), "Prompt Pool detail includes the item");

  const favorites = await requestJson(app, "/api/prompt-favorites");
  expect(favorites.response.status === 401, "Prompt favorites remain protected without AI Cove credentials");
  expect(isRecord(favorites.body.error), "Protected favorites return an error body");

  closeDatabase();
  console.log("prompt-pool-public-hosted-smoke.ts passed");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(promptPoolDir, { recursive: true, force: true });
}

type RequestApp = {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
};

async function requestJson(app: RequestApp, path: string): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await app.request(path);
  const body = (await response.json()) as unknown;
  expect(isRecord(body), `${path} response body is an object`);
  return { response, body };
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

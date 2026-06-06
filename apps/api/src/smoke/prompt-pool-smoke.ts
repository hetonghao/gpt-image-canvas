import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = join(tmpdir(), `gpt-image-canvas-prompt-pool-smoke-data-${process.pid}-${Date.now()}`);
const promptPoolDir = join(tmpdir(), `gpt-image-canvas-prompt-pool-smoke-pool-${process.pid}-${Date.now()}`);

process.env.DATA_DIR = dataDir;
process.env.PROMPT_POOL_DIR = promptPoolDir;
process.env.SQLITE_JOURNAL_MODE = "DELETE";
process.env.SQLITE_LOCKING_MODE = "EXCLUSIVE";

mkdirSync(dataDir, { recursive: true });
mkdirSync(promptPoolDir, { recursive: true });
writeFileSync(
  join(promptPoolDir, "summary.json"),
  JSON.stringify({
    rawBase: "https://raw.githubusercontent.com/mrslimslim/awesome-prompt/main",
    promptCount: 2,
    imagePromptCount: 1,
    videoPromptCount: 1,
    assetCount: 3,
    sourceSummary: {
      siteUrl: "https://www.meigen.ai/"
    }
  })
);
writeFileSync(
  join(promptPoolDir, "prompts-all.json"),
  JSON.stringify([
    {
      id: "prompt-one",
      title: "Prompt one",
      prompt: "Create a cinematic product poster.",
      mediaType: "image",
      model: "GPT Image",
      promptReady: true,
      localImages: ["images/prompt-one/0.webp", "images/prompt-one/1.webp"],
      imageWidth: 1024,
      imageHeight: 1536,
      author: {
        name: "Example Author",
        username: "example",
        verified: true,
        profileUrl: "https://x.com/example"
      },
      stats: {
        likes: 7,
        views: 42,
        retweets: 1
      }
    },
    {
      id: "prompt-two",
      title: "Prompt two",
      prompt: "Create a short video prompt.",
      mediaType: "video",
      model: "Seedance 2.0",
      promptReady: false,
      rawImage: "https://raw.githubusercontent.com/mrslimslim/awesome-prompt/main/video-thumbnails/prompt-two/0.webp",
      stats: {
        likes: 0,
        views: 3,
        retweets: 0
      }
    },
    {
      id: "invalid-no-asset",
      title: "Invalid",
      prompt: "This item has no image and should be filtered out."
    }
  ])
);

try {
  const [{ app }, { closeDatabase }] = await Promise.all([
    import("../index.js"),
    import("../infrastructure/database.js")
  ]);

  const pool = await requestJson(app, "/api/pool");
  expect(pool.response.status === 200, "Prompt Pool route returns 200");
  expect(pool.body.available === true, "Prompt Pool is available");
  expect(isRecord(pool.body.summary), "Prompt Pool response includes summary");
  expect(pool.body.summary.promptCount === 2, "Prompt Pool summary uses bundled summary");
  expect(Array.isArray(pool.body.items), "Prompt Pool response includes items");
  expect(pool.body.items.length === 2, "Prompt Pool filters out invalid items without assets");

  const first = pool.body.items[0];
  expect(isRecord(first), "Prompt Pool item is an object");
  expect(first.id === "prompt-one", "Prompt Pool item preserves id");
  expect(first.imageCount === 2, "Prompt Pool item counts available images");
  expect(
    first.assetUrl === "https://raw.githubusercontent.com/mrslimslim/awesome-prompt/main/images/prompt-one/0.webp",
    "Prompt Pool converts relative image paths to GitHub raw URLs"
  );

  const favoritesBefore = await requestJson(app, "/api/prompt-favorites");
  expect(favoritesBefore.response.status === 200, "Prompt favorites list returns 200");
  expect(Array.isArray(favoritesBefore.body.groups), "Prompt favorites response includes groups");
  expect(favoritesBefore.body.groups.length === 1, "Prompt favorites creates default group");

  const created = await requestJson(app, "/api/prompt-favorites", {
    method: "POST",
    body: {
      promptPoolItemId: "prompt-one"
    }
  });
  expect(created.response.status === 201, "Prompt favorite create returns 201");
  expect(isRecord(created.body.favorite), "Prompt favorite create returns favorite");
  expect(created.body.favorite.sourceId === "prompt-one", "Prompt favorite stores source prompt id");

  const favoriteId = String(created.body.favorite.id);
  const used = await requestJson(app, `/api/prompt-favorites/${favoriteId}/use`, { method: "POST" });
  expect(used.response.status === 200, "Prompt favorite use returns 200");
  expect(isRecord(used.body.favorite), "Prompt favorite use returns favorite");
  expect(used.body.favorite.useCount === 1, "Prompt favorite use increments use count");

  closeDatabase();
  console.log("prompt pool smoke checks passed");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(promptPoolDir, { recursive: true, force: true });
}

type RequestApp = {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
};

async function requestJson(
  app: RequestApp,
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const response = await app.request(path, {
    method: options?.method ?? "GET",
    headers: options?.body === undefined ? undefined : { "content-type": "application/json" },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body)
  });
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

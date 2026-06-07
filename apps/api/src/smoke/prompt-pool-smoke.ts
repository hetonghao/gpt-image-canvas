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
      prompt: `Create a short video prompt. ${"filler ".repeat(30)}hidden-back-half-token`,
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
  expect(pool.body.totalCount === 2, "Prompt Pool response includes the filtered total count");
  expect(pool.body.readyCount === 1, "Prompt Pool response includes the filtered ready count");
  expect(Array.isArray(pool.body.modelOptions), "Prompt Pool response includes model options");
  expect(pool.body.nextOffset === null, "Prompt Pool response omits next offset when all items fit");

  const firstPage = await requestJson(app, "/api/pool?limit=1");
  expect(firstPage.response.status === 200, "Prompt Pool paginated route returns 200");
  expect(Array.isArray(firstPage.body.items), "Prompt Pool paginated response includes items");
  expect(firstPage.body.items.length === 1, "Prompt Pool respects the requested page limit");
  expect(firstPage.body.totalCount === 2, "Prompt Pool paginated response keeps the full filtered total count");
  expect(firstPage.body.nextOffset === 1, "Prompt Pool response includes the next offset");

  const secondPage = await requestJson(app, "/api/pool?limit=1&offset=1");
  expect(secondPage.response.status === 200, "Prompt Pool second page route returns 200");
  expect(Array.isArray(secondPage.body.items), "Prompt Pool second page response includes items");
  expect(secondPage.body.items.length === 1, "Prompt Pool second page respects the requested page limit");
  expect(isRecord(secondPage.body.items[0]), "Prompt Pool second page item is an object");
  expect(secondPage.body.items[0].id === "prompt-two", "Prompt Pool offset returns the next item");

  const promptSearch = await requestJson(app, "/api/pool?q=hidden-back-half-token");
  expect(promptSearch.response.status === 200, "Prompt Pool search route returns 200");
  expect(Array.isArray(promptSearch.body.items), "Prompt Pool search response includes items");
  expect(promptSearch.body.items.length === 1, "Prompt Pool search filters results");
  expect(isRecord(promptSearch.body.items[0]), "Prompt Pool search item is an object");
  expect(promptSearch.body.items[0].id === "prompt-two", "Prompt Pool search uses the full prompt, not only the excerpt");

  const mediaFilter = await requestJson(app, "/api/pool?mediaType=image");
  expect(mediaFilter.response.status === 200, "Prompt Pool media filter route returns 200");
  expect(Array.isArray(mediaFilter.body.items), "Prompt Pool media filter response includes items");
  expect(mediaFilter.body.items.length === 1, "Prompt Pool media filter reduces results");
  expect(isRecord(mediaFilter.body.items[0]), "Prompt Pool media filter item is an object");
  expect(mediaFilter.body.items[0].id === "prompt-one", "Prompt Pool media filter uses full pool data");

  const compressedPoolResponse = await app.request("/api/pool", {
    headers: {
      "Accept-Encoding": "gzip"
    }
  });
  expect(compressedPoolResponse.status === 200, "Prompt Pool compressed route returns 200");
  expect(compressedPoolResponse.headers.get("content-encoding") === "gzip", "Prompt Pool list supports gzip compression");

  const first = pool.body.items[0];
  expect(isRecord(first), "Prompt Pool item is an object");
  expect(first.id === "prompt-one", "Prompt Pool item preserves id");
  expect(first.prompt === undefined, "Prompt Pool list omits full prompts");
  expect(first.promptExcerpt === "Create a cinematic product poster.", "Prompt Pool list includes a prompt excerpt");
  expect(first.promptLength === 34, "Prompt Pool list includes the full prompt length");
  expect(first.imageCount === 2, "Prompt Pool item counts available images");
  expect(
    first.assetUrl === "https://raw.githubusercontent.com/mrslimslim/awesome-prompt/main/images/prompt-one/0.webp",
    "Prompt Pool converts relative image paths to GitHub raw URLs"
  );

  const detail = await requestJson(app, "/api/pool/prompt-one");
  expect(detail.response.status === 200, "Prompt Pool detail route returns 200");
  expect(isRecord(detail.body.item), "Prompt Pool detail response includes item");
  expect(detail.body.item.prompt === "Create a cinematic product poster.", "Prompt Pool detail returns the full prompt");

  const missingDetail = await requestJson(app, "/api/pool/missing-prompt");
  expect(missingDetail.response.status === 404, "Prompt Pool detail returns 404 for missing items");

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

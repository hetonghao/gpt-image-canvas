const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const providerSources = {
  environment: {
    activeSource: { id: "env-openai", kind: "environment", label: "Environment OpenAI API", provider: "openai", available: true, status: "available" },
    source: {
      id: "env-openai",
      kind: "environment",
      label: "Environment OpenAI API",
      available: true,
      status: "available",
      details: { baseUrl: "https://fixture.invalid/v1", model: "gpt-image-2", resolvedModel2K: "gpt-image-2", resolvedModel4K: "gpt-image-2", timeoutMs: 1200000 },
      secret: { hasSecret: true, value: "sk-f********ture" }
    }
  },
  local: {
    activeSource: { id: "local-openai", kind: "local", label: "Custom OpenAI-compatible API", provider: "openai", available: true, status: "available" },
    source: {
      id: "local-openai",
      kind: "local",
      label: "Custom OpenAI-compatible API",
      available: true,
      status: "available",
      details: { baseUrl: "https://fixture.invalid/v1", model: "gpt-image-2", model2K: "fixture-image-2k", resolvedModel2K: "fixture-image-2k", resolvedModel4K: "gpt-image-2", timeoutMs: 1200000 },
      secret: { hasSecret: true, value: "sk-f********ture" }
    }
  }
};

function projectFixture() {
  return {
    id: "default",
    name: "Browser Contract Fixture",
    snapshot: {
      format: "ai-cove-excalidraw",
      version: 1,
      scene: {
        elements: [{
          id: "image-fixture",
          type: "image",
          x: 320,
          y: 280,
          width: 128,
          height: 128,
          angle: 0,
          strokeColor: "transparent",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 0,
          opacity: 100,
          groupIds: [],
          frameId: null,
          index: "a0",
          roundness: null,
          seed: 1966142085,
          version: 1,
          versionNonce: 1511457909,
          isDeleted: false,
          boundElements: null,
          updated: 1752451200000,
          link: null,
          locked: false,
          fileId: "file-fixture",
          status: "saved",
          scale: [1, 1],
          crop: null
        }],
        appState: {
          gridSize: null,
          selectedElementIds: { "image-fixture": true },
          theme: "light",
          viewBackgroundColor: "#f8f6f1"
        }
      },
      assets: {
        "file-fixture": {
          assetId: "canvas-asset",
          fileName: "fixture.png",
          mimeType: "image/png",
          width: 1,
          height: 1,
          byteSize: transparentPng.length,
          contentSha256: "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460"
        }
      }
    },
    history: [],
    updatedAt: "2026-07-14T00:00:00.000Z"
  };
}

function providerConfig(state) {
  const selected = providerSources[state.providerMode];
  const baseLocal = providerSources.local.source;
  const local = { ...baseLocal, details: { ...baseLocal.details, model: state.localModel, model2K: state.localModel2K, model4K: state.localModel4K, resolvedModel2K: state.localModel2K ?? state.localModel, resolvedModel4K: state.localModel4K ?? state.localModel } };
  const environment = providerSources.environment.source;
  return {
    sourceOrder: ["env-openai", "local-openai", "codex"],
    sources: [
      state.providerMode === "environment" ? environment : { ...environment, available: false, status: "missing_api_key", secret: { hasSecret: false } },
      local,
      { id: "codex", kind: "codex", label: "Codex", available: false, status: "missing_codex_session", details: { model: "gpt-image-2", resolvedModel2K: "gpt-image-2", resolvedModel4K: "gpt-image-2", codex: { available: false } }, secret: { hasSecret: false } }
    ],
    localOpenAI: { apiKey: local.secret, apiKeyId: "fixture-key", baseUrl: local.details.baseUrl, model: local.details.model, model2K: local.details.model2K, model4K: local.details.model4K, resolvedModel2K: local.details.resolvedModel2K, resolvedModel4K: local.details.resolvedModel4K, timeoutMs: local.details.timeoutMs },
    activeSource: selected.activeSource
  };
}

function json(route, value, status = 200) {
  return route.fulfill({ json: value, status });
}

function favoriteFixture(sourceId, userId) {
  return {
    id: `favorite-${userId}-${sourceId}`,
    sourceType: "pool",
    sourceId,
    groupId: "default",
    title: "确定性提示词",
    prompt: "斗鸣鸡公煲与城市夜景的确定性提示词",
    model: "Fixture",
    mediaType: "image",
    assetUrl: "/fixture/pool-image/1.png",
    imageWidth: 640,
    imageHeight: 480,
    useCount: 0,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z"
  };
}

export function createBrowserFixture() {
  const state = {
    canvasAuthFailure: false,
    canvasReady: false,
    favoriteFailure: false,
    favoriteMutationDelayMs: 0,
    favoriteSourceIdsByUserId: new Map(),
    galleryMode: "ready",
    galleryReady: false,
    galleryDeleted: false,
    galleryExportFailure: false,
    hostMode: "ai-cove-new-api",
    localModel: "gpt-image-2",
    localModel2K: "legacy-image-2k",
    localModel4K: undefined,
    poolBrokenImageId: null,
    poolDetailImageReady: true,
    poolImageRequests: [],
    poolMode: "ready",
    poolDetailFailure: false,
    providerMode: "local",
    providerSaveFailure: false,
    providerSaveRequests: [],
    generationRequest: undefined,
    generationRecord: undefined,
    generationMode: "failed"
  };

  async function handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === "/api/host/session" && method === "GET") return json(route, { adapter: { mode: state.hostMode, aiCoveApiBaseUrl: "http://127.0.0.1:8080", gatewayBaseUrl: "http://127.0.0.1:8080/v1" }, user: { id: "fixture-user", displayName: "Browser Fixture" } });
    if (url.pathname === "/api/host/api-keys" && method === "GET") return json(route, { items: [{ id: "fixture-key", name: "Fixture key", maskedKey: "sk-f********ture" }] });
    if (url.pathname === "/api/host/models" && method === "GET") return json(route, { items: [{ id: "gpt-image-2" }, { id: "fixture-image-2k" }, { id: "fixture-image-4k" }] });
    if (url.pathname === "/api/project" && method === "GET") return json(route, projectFixture());
    if (url.pathname === "/api/project" && method === "PUT") return json(route, { id: "default", ok: true, updatedAt: "2026-07-14T00:00:00.000Z" });
    if (url.pathname === "/api/provider-config" && method === "GET") return json(route, providerConfig(state));
    if (url.pathname === "/api/provider-config" && method === "PUT") {
      const payload = request.postDataJSON();
      state.providerSaveRequests.push(payload);
      if (state.providerSaveFailure) return json(route, { code: "provider_config_error", message: "受控配置保存失败" }, 503);
      state.localModel = payload.localOpenAI.model;
      state.localModel2K = payload.localOpenAI.model2K || undefined;
      state.localModel4K = payload.localOpenAI.model4K || undefined;
      return json(route, providerConfig(state));
    }
    if (url.pathname === "/api/auth/status" && method === "GET") return json(route, { provider: "openai", openaiConfigured: true, codex: { available: false }, activeSource: providerSources[state.providerMode].activeSource });
    if (url.pathname === "/api/prompt-favorites" && method === "GET") {
      if (state.favoriteFailure) return json(route, { code: "favorites_unavailable", message: "Fixture favorites unavailable." }, 503);
      const userId = request.headers()["new-api-user"] ?? "browser";
      const sourceId = state.favoriteSourceIdsByUserId.get(userId);
      return json(route, {
        groups: [{ id: "default", name: "常用", sortOrder: 0, isDefault: true, createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z" }],
        favorites: sourceId ? [favoriteFixture(sourceId, userId)] : []
      });
    }
    if (url.pathname === "/api/prompt-favorites" && method === "POST") {
      const userId = request.headers()["new-api-user"] ?? "browser";
      const sourceId = request.postDataJSON().promptPoolItemId;
      if (state.favoriteMutationDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, state.favoriteMutationDelayMs));
      }
      return json(route, { favorite: favoriteFixture(sourceId, userId) });
    }
    if (url.pathname === "/api/storage/config" && method === "GET") return json(route, { enabled: false, provider: "cos", cos: { secretId: "", secretKey: { hasSecret: false }, bucket: "", region: "", keyPrefix: "" }, s3: { accessKeyId: "", secretAccessKey: { hasSecret: false }, bucket: "", region: "auto", keyPrefix: "", endpointMode: "custom", accountId: "", endpoint: "", forcePathStyle: false } });
    if (url.pathname === "/api/agent-config" && method === "GET") return json(route, { configured: false, apiKey: { hasSecret: false }, baseUrl: "", model: "", timeoutMs: 60000, supportsVision: false, createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z" });
    if (url.pathname === "/api/summary-config" && method === "GET") return json(route, { configured: false, apiKey: { hasSecret: false }, baseUrl: "", model: "", timeoutMs: 60000, supportsVision: true, createdAt: "2026-07-14T00:00:00.000Z", updatedAt: "2026-07-14T00:00:00.000Z" });
    if (url.pathname === "/api/gallery" && method === "GET") {
      if (state.galleryMode === "error") return json(route, { code: "gallery_unavailable", message: "Fixture Gallery unavailable." }, 503);
      const items = state.galleryMode === "empty" || state.galleryDeleted ? [] : [{ outputId: "gallery-output", generationId: "gallery-generation", mode: "generate", prompt: "浏览器契约破损图库", effectivePrompt: "浏览器契约破损图库", presetId: "none", size: { width: 640, height: 480 }, quality: "high", outputFormat: "png", createdAt: "2026-07-14T00:00:00.000Z", asset: { id: "gallery-asset", url: "/api/assets/gallery-asset", fileName: "gallery.png", mimeType: "image/png", width: 640, height: 480 } }];
      return json(route, { items });
    }
    if (url.pathname === "/api/gallery/export" && method === "POST") {
      return state.galleryExportFailure
        ? json(route, { code: "gallery_export_failed", message: "Fixture Gallery export failed." }, 503)
        : route.fulfill({ body: Buffer.from("fixture zip"), contentType: "application/zip", status: 200 });
    }
    if (url.pathname === "/api/gallery/gallery-output" && method === "DELETE") {
      state.galleryDeleted = true;
      return json(route, { ok: true });
    }
    if (url.pathname === "/api/pool" && method === "GET") {
      if (state.poolMode === "error") return json(route, { code: "pool_unavailable", message: "Fixture Pool unavailable." }, 503);
      const empty = Boolean(url.searchParams.get("q"));
      const items = state.poolMode === "empty" || empty ? [] : Array.from({ length: 36 }, (_, index) => ({ id: index === 0 ? "fixture-prompt" : `fixture-prompt-${index + 1}`, title: `确定性提示词 ${index + 1}`, mediaType: "image", model: "Fixture", postedAt: "now", promptReady: true, assetUrl: `/fixture/pool-image/${index + 1}.png`, imageCount: 1, imageWidth: 640, imageHeight: 480, stats: { likes: index + 1, views: index + 1, retweets: 0 }, promptExcerpt: index === 0 ? "斗鸣鸡公煲与城市夜景的确定性提示词" : `滚动懒加载提示词 ${index + 1}`, promptLength: 18 }));
      return json(route, { available: true, items, limit: 72, modelOptions: items.length === 0 ? [] : [{ model: "Fixture", count: items.length }], nextOffset: null, offset: 0, readyCount: items.length, summary: { promptCount: items.length, imagePromptCount: items.length, videoPromptCount: 0, assetCount: items.length }, totalCount: items.length });
    }
    if (url.pathname === "/api/pool/fixture-prompt" && method === "GET") {
      if (state.poolDetailFailure) return json(route, { code: "pool_detail_failed", message: "Fixture Pool detail failed." }, 503);
      return json(route, {
        item: {
          id: "fixture-prompt",
          title: "确定性提示词",
          mediaType: "image",
          model: "Fixture",
          postedAt: "now",
          promptReady: true,
          assetUrl: "/fixture/pool-detail.png",
          imageCount: 1,
          imageWidth: 1,
          imageHeight: 1,
          stats: { likes: 1, views: 1, retweets: 0 },
          promptExcerpt: "确定性提示词",
          promptLength: 7,
          prompt: "斗鸣鸡公煲与城市夜景的确定性提示词"
        }
      });
    }
    if (/^\/api\/assets\/(canvas|gallery)-asset\/preview$/u.test(url.pathname) && method === "GET") {
      const ready = url.pathname.includes("canvas") ? state.canvasReady : state.galleryReady;
      return ready ? route.fulfill({ body: transparentPng, contentType: "image/png", status: 200 }) : json(route, { code: "not_found", message: "Fixture asset unavailable." }, 404);
    }
    if (url.pathname === "/api/assets/canvas-asset/metadata" && method === "GET") {
      if (state.canvasAuthFailure) {
        return json(route, { code: "unauthorized", message: "Fixture canvas session expired." }, 401);
      }
      return json(route, {
        assetId: "canvas-asset",
        fileName: "fixture.png",
        mimeType: "image/png",
        width: 1,
        height: 1,
        byteSize: transparentPng.length,
        contentSha256: "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460"
      });
    }
    if (/^\/fixture\/pool-image\/\d+\.png$/u.test(url.pathname) && method === "GET") {
      state.poolImageRequests.push(url.pathname);
      const imageId = Number.parseInt(url.pathname.match(/\d+/u)?.[0] ?? "0", 10);
      return state.poolBrokenImageId === imageId
        ? json(route, { code: "not_found", message: "Fixture Pool image unavailable." }, 404)
        : route.fulfill({ body: transparentPng, contentType: "image/png", status: 200 });
    }
    if (url.pathname === "/fixture/pool-detail.png" && method === "GET") {
      return state.poolDetailImageReady
        ? route.fulfill({ body: transparentPng, contentType: "image/png", status: 200 })
        : json(route, { code: "not_found", message: "Fixture Pool detail image unavailable." }, 404);
    }
    if (url.pathname === "/api/assets/canvas-asset" && method === "GET") {
      return state.canvasReady ? route.fulfill({ body: transparentPng, contentType: "image/png", status: 200 }) : json(route, { code: "not_found", message: "Fixture asset unavailable." }, 404);
    }
    if (url.pathname === "/api/assets/gallery-asset" && method === "GET") {
      return state.galleryReady ? route.fulfill({ body: transparentPng, contentType: "image/png", status: 200 }) : json(route, { code: "not_found", message: "Fixture asset unavailable." }, 404);
    }
    if (url.pathname === "/api/images/generate" && method === "POST") {
      state.generationRequest = request.postDataJSON();
      const isLoading = state.generationMode === "loading";
      state.generationRecord = { id: state.generationRequest.clientRequestId, mode: "generate", prompt: state.generationRequest.prompt, effectivePrompt: state.generationRequest.prompt, presetId: state.generationRequest.presetId, size: state.generationRequest.size, resolutionTier: "4K", model: "gpt-image-2", providerSourceId: "local-openai", modelFallback: true, quality: state.generationRequest.quality, outputFormat: state.generationRequest.outputFormat, count: state.generationRequest.count, status: isLoading ? "running" : "failed", error: isLoading ? "" : "受控上游失败", retryCount: isLoading ? 0 : 1, createdAt: "2026-07-14T00:00:00.000Z", outputs: [{ id: "fixture-output", status: isLoading ? "pending" : "failed", error: isLoading ? "" : "受控上游失败" }] };
      return json(route, { record: state.generationRecord });
    }
    if (state.generationRecord && url.pathname === `/api/generations/${encodeURIComponent(state.generationRecord.id)}` && method === "GET") return json(route, { record: state.generationRecord });
    return json(route, { code: "not_found", message: `Unhandled fixture route: ${method} ${url.pathname}` }, 404);
  }

  return { handle, state };
}

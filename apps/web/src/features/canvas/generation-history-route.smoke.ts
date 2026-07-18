import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GenerationRouteMetadata } from "./GenerationRouteMetadata";

const labels = {
  legacy: "旧记录未保存模型路由信息",
  model: "实际模型",
  modelFallback: "已使用默认模型",
  pending: "模型路由尚未完成",
  resolution: "请求分辨率",
  route: "模型路由"
} as const;

const currentRecordMarkup = renderToStaticMarkup(
  createElement(GenerationRouteMetadata, {
    labels,
    model: "gpt-image-2-4k",
    modelFallback: true,
    resolutionTier: "4K"
  })
);

assert.match(currentRecordMarkup, /请求分辨率<\/dt><dd>4K/u, "history should visibly render the requested resolution tier");
assert.match(currentRecordMarkup, /实际模型<\/dt><dd>gpt-image-2-4k/u, "history should visibly render the resolved model");
assert.doesNotMatch(currentRecordMarkup, /生成源|local-openai/u, "history should not expose the internal provider source name");
assert.match(currentRecordMarkup, /已使用默认模型/u, "history should visibly explain model fallback");

const agentJobMarkup = renderToStaticMarkup(
  createElement(GenerationRouteMetadata, {
    labels,
    model: "gpt-image-2-4k",
    modelFallback: false,
    resolutionTier: "4K",
    size: { width: 3840, height: 2160 }
  })
);

assert.match(agentJobMarkup, /请求分辨率<\/dt><dd>4K 3840×2160/u, "Agent job details should include the requested size");

const pendingRouteMarkup = renderToStaticMarkup(
  createElement(GenerationRouteMetadata, {
    labels,
    model: undefined,
    modelFallback: undefined,
    resolutionTier: "4K"
  })
);

assert.match(pendingRouteMarkup, /模型路由尚未完成/u, "new records should explain when provider routing did not complete");

const legacyRecordMarkup = renderToStaticMarkup(
  createElement(GenerationRouteMetadata, {
    labels,
    model: undefined,
    modelFallback: undefined,
    resolutionTier: undefined
  })
);

assert.match(
  legacyRecordMarkup,
  /旧记录未保存模型路由信息/u,
  "legacy generation records should visibly explain that model route metadata was not saved"
);

process.stdout.write("generation-history-route.smoke.ts passed\n");

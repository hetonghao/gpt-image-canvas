import assert from "node:assert/strict";

import {
  appendRegionPromptToken,
  buildRegionEnhancedPrompt,
  createManualRegionPromptItem,
  defaultRegionForPoint,
  finalRegionPromptForModel,
  insertRegionPromptDocumentTokenAtCursor,
  insertRegionPromptToken,
  insertRegionPromptTokenAtCursor,
  promptIncludesRegionItemToken,
  promptIncludesRegionToken,
  promptWithRegionTokens,
  regionPromptPendingToken,
  regionPreviewAspectRatio,
  regionPixelBounds,
  regionPrecisionText,
  regionPromptTokenRanges,
  removeRegionPromptItemToken,
  removeRegionPromptPendingTokens,
  removeRegionPromptToken,
  removeRegionPromptTokens,
  replaceRegionPromptPendingToken,
  referencesForRegionPromptItems,
  regionFromDrag,
  regionSummaryAvailability,
  type RegionPromptReference,
  type RegionPromptItem
} from "./region-prompt.js";
import { referenceAssetIdsForRequest, shouldSendReferenceImages } from "./reference-request.js";

assert.deepEqual(defaultRegionForPoint(0.02, 0.02), { x: 0, y: 0, width: 0.24, height: 0.24 }, "click region clamps to top-left");
assert.deepEqual(
  regionPixelBounds({ x: 0.32, y: 0.18, width: 0.22, height: 0.34 }, { width: 1024, height: 768 }),
  { x: 327, y: 138, width: 226, height: 262 },
  "region pixel bounds match the crop rectangle sent to the summary model"
);
assert.equal(
  regionPreviewAspectRatio({ x: 0.38, y: 0.24, width: 0.24, height: 0.24 }, { width: 1024, height: 1024 }),
  "246 / 246",
  "preview aspect ratio follows the actual square crop bounds"
);
assert.equal(
  regionPreviewAspectRatio({ x: 0.32, y: 0.18, width: 0.22, height: 0.34 }, { width: 1024, height: 768 }),
  "226 / 262",
  "preview aspect ratio follows non-square crop bounds"
);
assert.match(
  regionPrecisionText({ x: 0.32, y: 0.18, width: 0.22, height: 0.34 }, { width: 1024, height: 768 }, "zh-CN"),
  /裁剪范围：原图 1024x768，x=327，y=138，宽=226，高=262/,
  "Chinese precision text exposes the actual crop bounds"
);
assert.match(
  regionPrecisionText({ x: 0.32, y: 0.18, width: 0.22, height: 0.34 }, { width: 1024, height: 768 }, "en"),
  /Crop bounds: source 1024x768, x=327, y=138, width=226, height=262/,
  "English precision text exposes the actual crop bounds"
);
assert.deepEqual(
  regionFromDrag({ x: 0.2, y: 0.2 }, { x: 0.5, y: 0.6 }),
  { x: 0.2, y: 0.2, width: 0.3, height: 0.39999999999999997 },
  "drag region normalizes direction"
);
assert.deepEqual(
  referenceAssetIdsForRequest([
    { localAssetId: "asset-a" },
    { localAssetId: "asset-b" }
  ]),
  ["asset-a", "asset-b"],
  "stored reference request can use asset ids only"
);
assert.equal(referenceAssetIdsForRequest([]), undefined, "empty reference request does not produce asset ids");
assert.equal(
  shouldSendReferenceImages([
    { localAssetId: "asset-a" },
    { localAssetId: "asset-b" }
  ]),
  false,
  "stored reference request avoids client base64 images"
);
assert.equal(
  shouldSendReferenceImages([
    { localAssetId: "asset-a" },
    {}
  ]),
  true,
  "mixed non-stored references still need image data"
);

assert.deepEqual(
  regionSummaryAvailability({
    summaryConfig: {
      configured: true,
      apiKey: { hasSecret: true },
      baseUrl: "",
      model: "gemini-2.5-flash",
      timeoutMs: 60000,
      supportsVision: true,
      createdAt: "",
      updatedAt: ""
    },
    agentConfig: null,
    isSummaryConfigLoading: false,
    isAgentConfigLoading: false
  }),
  { status: "ready", source: "summary" },
  "vision-capable Summary LLM is preferred"
);

assert.deepEqual(
  regionSummaryAvailability({
    summaryConfig: {
      configured: true,
      apiKey: { hasSecret: true },
      baseUrl: "",
      model: "text-only",
      timeoutMs: 60000,
      supportsVision: false,
      createdAt: "",
      updatedAt: ""
    },
    agentConfig: {
      configured: true,
      apiKey: { hasSecret: true },
      baseUrl: "",
      model: "gpt-4.1-mini",
      timeoutMs: 60000,
      supportsVision: true,
      createdAt: "",
      updatedAt: ""
    },
    isSummaryConfigLoading: false,
    isAgentConfigLoading: false
  }),
  { status: "summary-no-vision" },
  "configured non-vision Summary LLM blocks silent Agent fallback"
);

const dressReference: RegionPromptReference = {
  key: "asset-dress",
  assetId: "asset:dress",
  localAssetId: "dress",
  name: "dress.png",
  sourceUrl: "/api/assets/dress/preview",
  width: 1024,
  height: 1024
};
const shoeReference: RegionPromptReference = {
  key: "asset-shoes",
  assetId: "asset:shoes",
  localAssetId: "shoes",
  name: "shoes.png",
  sourceUrl: "/api/assets/shoes/preview",
  width: 1024,
  height: 1024
};

const regions: RegionPromptItem[] = [
  {
    id: "region-1",
    mode: "auto",
    label: "红色连衣裙",
    description: "人物身上的红色无袖连衣裙，位于画面中央",
    note: "replace with a white wedding dress",
    region: { x: 0.32, y: 0.18, width: 0.22, height: 0.34 },
    reference: dressReference,
    status: "ready"
  }
];

const prompt = buildRegionEnhancedPrompt("把{红色连衣裙}换成白色婚纱", regions);
assert.match(prompt, /Edit the selected reference image directly/, "structured prompt preserves edit intent");
assert.match(prompt, /\{红色连衣裙\}: 人物身上的红色无袖连衣裙/, "structured prompt includes region label and description");
assert.match(prompt, /User note: replace with a white wedding dress/, "structured prompt includes local user note");
const zhPrompt = buildRegionEnhancedPrompt("把{红色连衣裙}换成白色婚纱", regions, "zh-CN");
assert.match(zhPrompt, /直接编辑所选参考图/, "structured prompt follows the active Chinese locale");
assert.match(zhPrompt, /用户需求：\n把\{红色连衣裙\}换成白色婚纱/, "Chinese structured prompt keeps the visible request");

const manualRegion = createManualRegionPromptItem({
  id: "region-2",
  label: "黑色高跟鞋",
  reference: shoeReference,
  region: defaultRegionForPoint(0.72, 0.82)
});
const anchoredManualRegion = {
  ...manualRegion,
  insertionIndex: 1
};
const secondAnchoredManualRegion: RegionPromptItem = {
  ...manualRegion,
  id: "region-3",
  label: "蓝色手包",
  insertionIndex: 1
};
assert.equal(manualRegion.mode, "manual", "manual annotation does not need a model");
assert.equal(manualRegion.label, "黑色高跟鞋", "manual annotation uses the user-written label");
assert.match(
  buildRegionEnhancedPrompt("把{黑色高跟鞋}换成银色", [manualRegion]),
  /\{黑色高跟鞋\}: bottom right selected area/,
  "manual annotation falls back to deterministic region wording"
);
const manualRegionZh = createManualRegionPromptItem({
  id: "region-2-zh",
  label: "黑色高跟鞋",
  locale: "zh-CN",
  reference: shoeReference,
  region: defaultRegionForPoint(0.72, 0.82)
});
assert.match(
  buildRegionEnhancedPrompt("把{黑色高跟鞋}换成银色", [manualRegionZh], "zh-CN"),
  /\{黑色高跟鞋\}：画面右下方的选中区域/,
  "manual annotation deterministic region wording follows Chinese locale"
);
assert.equal(
  promptWithRegionTokens("把画面里的元素替换一下", [manualRegion]),
  "把画面里的元素替换一下 {黑色高跟鞋}",
  "region tags are appended to the submitted user prompt with braces"
);
assert.equal(
  promptWithRegionTokens("  ", [manualRegion]),
  "{黑色高跟鞋}",
  "region tags can form the submitted prompt when the user text is empty"
);
assert.equal(
  promptWithRegionTokens("把{黑色高跟鞋}换成银色", [manualRegion]),
  "把{黑色高跟鞋}换成银色",
  "region tags already present in visible prompt are not duplicated"
);
assert.equal(
  promptWithRegionTokens("把换成银色", [anchoredManualRegion]),
  "把 {黑色高跟鞋} 换成银色",
  "missing region tags are composed at their frozen insertion point"
);
assert.equal(
  promptWithRegionTokens("把换成银色", [anchoredManualRegion, secondAnchoredManualRegion]),
  "把 {黑色高跟鞋} {蓝色手包} 换成银色",
  "multiple missing region tags with the same frozen insertion point keep click order"
);
assert.equal(
  appendRegionPromptToken("把画面主体换掉", manualRegion),
  "把画面主体换掉 {黑色高跟鞋}",
  "adding a region inserts its token into the visible prompt value"
);
assert.equal(
  appendRegionPromptToken("把画面主体换掉 {黑色高跟鞋}", manualRegion),
  "把画面主体换掉 {黑色高跟鞋}",
  "adding a region keeps existing visible tokens stable"
);
assert.equal(
  insertRegionPromptToken("把换成银色", manualRegion, 1),
  "把 {黑色高跟鞋} 换成银色",
  "adding a region inserts its token at the current prompt cursor"
);
assert.deepEqual(
  insertRegionPromptTokenAtCursor("把换成银色", manualRegion, 1),
  {
    prompt: "把 {黑色高跟鞋} 换成银色",
    cursorIndex: "把 {黑色高跟鞋} ".length
  },
  "adding a region returns the cursor after the inserted token separator so IME composition starts in text"
);
assert.equal(
  insertRegionPromptToken("换成银色", manualRegion, 0),
  "{黑色高跟鞋} 换成银色",
  "adding a region at the start keeps prompt spacing readable"
);
assert.equal(
  insertRegionPromptToken("把{黑色高跟鞋}换成银色", manualRegion, 1),
  "把{黑色高跟鞋}换成银色",
  "inserting a region keeps an existing token stable"
);

const pendingRegion: RegionPromptItem = {
  ...manualRegion,
  id: "region-pending",
  mode: "auto",
  label: "",
  description: "",
  status: "summarizing",
  insertionIndex: 1
};
const pendingToken = regionPromptPendingToken(pendingRegion.id);
const pendingInsertion = insertRegionPromptDocumentTokenAtCursor("把换成银色", pendingRegion, 1);
assert.deepEqual(
  pendingInsertion,
  {
    prompt: `把 ${pendingToken} 换成银色`,
    cursorIndex: `把 ${pendingToken} `.length,
    from: 1,
    to: 1,
    insert: ` ${pendingToken} `,
    token: pendingToken,
    changed: true
  },
  "summarizing regions insert a stable hidden document token at the frozen cursor"
);
assert.equal(promptIncludesRegionItemToken(pendingInsertion.prompt, pendingRegion), true, "pending region tokens keep the item bound");
assert.deepEqual(
  regionPromptTokenRanges(pendingInsertion.prompt, [pendingRegion]).map((range) => ({
    from: range.from,
    to: range.to,
    itemId: range.region.id,
    label: range.label,
    status: range.region.status
  })),
  [
    {
      from: 2,
      to: 2 + pendingToken.length,
      itemId: pendingRegion.id,
      label: "",
      status: "summarizing"
    }
  ],
  "pending document tokens can render as inline chip decorations"
);

const summarizedRegion: RegionPromptItem = {
  ...pendingRegion,
  label: "红色连衣裙",
  description: "人物身上的红色连衣裙，位于画面中央",
  status: "ready"
};
assert.deepEqual(
  replaceRegionPromptPendingToken(pendingInsertion.prompt, summarizedRegion),
  {
    prompt: "把 {红色连衣裙} 换成银色",
    from: 2,
    to: 2 + pendingToken.length,
    insert: "{红色连衣裙}",
    changed: true
  },
  "summary completion replaces the original pending token in place"
);
assert.equal(
  removeRegionPromptPendingTokens(`把 ${pendingToken} 换成银色`),
  "把 换成银色",
  "pending internal tokens are removed before building the model prompt"
);
assert.equal(
  removeRegionPromptItemToken(`把 ${pendingToken} 换成银色`, pendingRegion),
  "把 换成银色",
  "removing a pending region deletes its hidden document token"
);
assert.equal(
  removeRegionPromptItemToken("把 {红色连衣裙} 换成银色", summarizedRegion),
  "把 换成银色",
  "removing a ready region deletes its visible brace token"
);
assert.equal(
  removeRegionPromptToken("把画面主体换掉 {黑色高跟鞋}", "黑色高跟鞋"),
  "把画面主体换掉",
  "removing a region deletes its token from the visible prompt value"
);
assert.equal(
  removeRegionPromptTokens("把 {红色连衣裙} 和 {黑色高跟鞋} 都替换", [manualRegion]),
  "把 {红色连衣裙} 和 都替换",
  "removing regions only strips matching visible tokens"
);
assert.equal(promptIncludesRegionToken("把{黑色高跟鞋}换成银色", "黑色高跟鞋"), true, "token lookup recognizes visible prompt tokens");
assert.equal(promptIncludesRegionToken("把黑色高跟鞋换成银色", "黑色高跟鞋"), false, "plain text is not treated as a bound tag");
assert.deepEqual(
  regionPromptTokenRanges("把画面主体换掉 {黑色高跟鞋}", [manualRegion]).map((range) => ({
    from: range.from,
    to: range.to,
    label: range.label
  })),
  [{ from: 8, to: 15, label: "黑色高跟鞋" }],
  "visible prompt token placeholders can render as inline chips"
);

const finalPrompt = finalRegionPromptForModel("把画面里的元素替换一下", [regions[0], manualRegion]);
assert.match(
  finalPrompt,
  /User request:\n把画面里的元素替换一下 \{红色连衣裙\} \{黑色高跟鞋\}/,
  "final prompt keeps the visible prompt request plus brace-wrapped region tokens"
);
assert.match(
  finalPrompt,
  /1\. Reference image 1 \{红色连衣裙\}: 人物身上的红色无袖连衣裙/,
  "final prompt names the dependent reference image for the auto region"
);
assert.match(finalPrompt, /Crop bounds: source 1024x1024, x=327, y=184, width=226, height=349/, "final prompt includes exact crop bounds");
assert.match(
  finalPrompt,
  /2\. Reference image 2 \{黑色高跟鞋\}: bottom right selected area/,
  "final prompt names the dependent reference image for the manual region"
);
const finalPromptZh = finalRegionPromptForModel("把画面里的元素替换一下", [regions[0], manualRegionZh], "zh-CN");
assert.match(finalPromptZh, /用户需求：\n把画面里的元素替换一下 \{红色连衣裙\} \{黑色高跟鞋\}/, "Chinese final prompt keeps the user request");
assert.match(finalPromptZh, /裁剪范围：原图 1024x1024，x=327，y=184，宽=226，高=349/, "Chinese final prompt includes exact crop bounds");
assert.match(finalPromptZh, /2\. 参考图 2 \{黑色高跟鞋\}：画面右下方的选中区域/, "Chinese final prompt localizes the generated context");

assert.deepEqual(
  referencesForRegionPromptItems([
    regions[0],
    {
      ...regions[0],
      id: "region-duplicate",
      status: "summarizing"
    },
    manualRegion
  ]),
  [dressReference, shoeReference],
  "dependent references are derived from tags and deduplicated"
);

process.stdout.write("region-prompt.smoke.ts passed\n");

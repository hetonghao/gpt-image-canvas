import assert from "node:assert/strict";

async function visiblePanelControl(page, testId) {
  const control = page.getByTestId(testId);
  await page.getByTestId("canvas-shell").waitFor();
  const trigger = page.getByTestId("open-ai-panel");
  await trigger.waitFor({ state: "attached" });
  if (await trigger.isVisible() && await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await control.waitFor();
  return control;
}

function waitForPreview(page, assetId) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === `/api/assets/${assetId}/preview`);
}

function viewportTargetSize(viewport) {
  return viewport.width <= 768 ? 44 : 40;
}

export async function runCanvasContracts({ baseUrl, fixture, page, viewport }) {
  fixture.state.canvasReady = false;
  const targetSize = viewportTargetSize(viewport);
  await page.goto(`${baseUrl}/?ui_mode=embedded`);
  const canvasAssetAlert = page.getByTestId("canvas-asset-unavailable");
  await canvasAssetAlert.waitFor();
  assert.match(await canvasAssetAlert.innerText(), /画布图片不可用/u, "Canvas uses the shared unavailable asset state");
  const canvasRetry = canvasAssetAlert.getByRole("button", { name: "重新检查" });
  assert.ok((await canvasRetry.boundingBox())?.height >= targetSize, "Canvas retry keeps the viewport target size");
  const canvasFailedRetry = waitForPreview(page, "canvas-asset");
  await canvasRetry.click();
  assert.equal((await canvasFailedRetry).status(), 404, "Canvas retry observes the failed preview response");
  fixture.state.canvasReady = true;
  const canvasRecoveredRetry = waitForPreview(page, "canvas-asset");
  await canvasRetry.click();
  assert.equal((await canvasRecoveredRetry).ok(), true, "Canvas retry observes the recovered preview response");
  await canvasAssetAlert.waitFor({ state: "hidden" });

  const providerTrigger = page.getByTestId("global-provider-settings");
  await providerTrigger.click();
  const providerDialog = page.getByRole("dialog", { name: "生成服务配置" });
  await providerDialog.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "关闭生成服务配置");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "关闭生成服务配置", "Provider dialog receives deterministic initial focus");
  assert.equal(await providerTrigger.evaluate((element) => Boolean(element.closest("[inert]"))), true, "Provider dialog makes the background inert");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await providerDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true, "Provider dialog keeps reverse focus traversal inside");
  const dialogFocusables = providerDialog.locator('button:visible:not([disabled]), input:visible:not([disabled]), select:visible:not([disabled]), [tabindex="0"]:visible');
  await dialogFocusables.last().focus();
  await page.keyboard.press("Tab");
  assert.equal(await providerDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true, "Provider dialog keeps forward focus traversal inside");
  assert.equal(await page.getByTestId("provider-local-base-url").count(), 0, "AI Cove image configuration hides the fixed gateway Base URL");
  assert.doesNotMatch(await providerDialog.innerText(), /自定义 OpenAI|local-openai|用户配置源/u, "AI Cove configuration does not expose a single-source implementation label");
  const savedUnknownModel = page.getByTestId("provider-local-model-2k");
  assert.equal(await savedUnknownModel.inputValue(), "legacy-image-2k", "Provider dialog keeps the saved model selected");
  assert.equal(await savedUnknownModel.locator('option[value="legacy-image-2k"]').count(), 1, "Provider dialog renders an unknown saved model");
  const defaultImageModel = page.getByTestId("provider-local-model");
  assert.equal(await defaultImageModel.getAttribute("required"), "", "Default image model exposes its required contract");
  await defaultImageModel.selectOption("");
  const saveRequestCount = fixture.state.providerSaveRequests.length;
  await page.getByTestId("provider-config-save").click();
  const requiredModelAlert = providerDialog.getByRole("alert");
  await requiredModelAlert.waitFor();
  assert.match(await requiredModelAlert.innerText(), /默认图片模型.*必填/u, "Provider dialog explains that the default image model is required");
  assert.equal(await defaultImageModel.evaluate((element) => document.activeElement === element), true, "Invalid default image model receives focus");
  assert.equal(fixture.state.providerSaveRequests.length, saveRequestCount, "Invalid default image model never reaches the API");
  await defaultImageModel.selectOption("gpt-image-2");
  await savedUnknownModel.selectOption("");
  await page.getByTestId("provider-config-save").click();
  await providerDialog.getByRole("status").waitFor();
  const clearRequest = fixture.state.providerSaveRequests.at(-1);
  assert.deepEqual(clearRequest.sourceOrder, ["env-openai", "local-openai", "codex"], "AI Cove saves keep the standalone-compatible source order internal");
  assert.equal(clearRequest.localOpenAI.model2K, "", "Provider dialog persists an explicit 2K model clear");
  assert.equal(await savedUnknownModel.inputValue(), "", "Provider dialog renders the persisted empty 2K model");
  assert.match(await providerDialog.innerText(), /跟随默认图片模型（当前：gpt-image-2）/u, "Cleared 2K model renders the dynamic default-model fallback");
  if (viewport.width <= 480) {
    const fallbackDisplay = page.getByTestId("provider-local-model-2k-display");
    await fallbackDisplay.waitFor();
    assert.match(await fallbackDisplay.innerText(), /跟随默认图片模型（当前：gpt-image-2）/u, "Narrow Provider fields show the complete fallback inside the control");
    assert.equal(await fallbackDisplay.locator(".provider-resolution-model__name").evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects().length;
    }), 1, "Narrow Provider fields keep the technical model identifier intact");
  }
  assert.equal(await providerDialog.locator(".provider-priority-item__drag, .provider-icon-button").count(), 0, "AI Cove mode hides standalone Provider priority controls");
  await savedUnknownModel.selectOption("fixture-image-2k");
  await page.getByTestId("provider-config-save").click();
  await page.waitForFunction(() => document.querySelector('[data-testid="provider-local-model-2k"]')?.value === "fixture-image-2k");
  fixture.state.providerSaveFailure = true;
  await page.getByTestId("provider-local-model-4k").selectOption("fixture-image-4k");
  await page.getByTestId("provider-config-save").click();
  const saveFailureAlert = providerDialog.getByRole("alert");
  await saveFailureAlert.waitFor();
  assert.match(await saveFailureAlert.innerText(), /服务配置请求失败.*503/u, "Provider dialog renders the API save failure");
  fixture.state.providerSaveFailure = false;
  await page.getByTestId("provider-config-tab-agent").click();
  assert.equal(await page.getByTestId("provider-agent-base-url").count(), 0, "AI Cove Agent configuration hides the fixed gateway Base URL");
  await page.getByTestId("provider-config-tab-summary").click();
  assert.equal(await page.getByTestId("provider-summary-base-url").count(), 0, "AI Cove Summary configuration hides the fixed gateway Base URL");
  if (viewport.width <= 480) {
    const summaryHintPhrases = page.getByTestId("summary-llm-gemini-hint").locator(".provider-config-inline-hint__keep");
    assert.equal(await summaryHintPhrases.count(), 3, "Summary guidance exposes its action, outcome, and fallback phrases as stable layout units");
    assert.equal(await summaryHintPhrases.evaluateAll((elements) => elements.every((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects().length === 1;
    })), true, "Narrow Summary guidance keeps each short semantic phrase on one line");
    const summaryModelDisplay = page.getByTestId("provider-summary-model-display");
    const summaryModelLayout = await summaryModelDisplay.evaluate((display) => {
      const chevron = display.querySelector(".provider-model-select__chevron");
      if (!chevron) return null;
      const displayRect = display.getBoundingClientRect();
      const chevronRect = chevron.getBoundingClientRect();
      return { trailingSpace: displayRect.right - chevronRect.right };
    });
    assert.ok(summaryModelLayout && summaryModelLayout.trailingSpace <= 40, "Narrow empty model fields keep the chevron at the control edge");
  }
  await page.getByTestId("provider-config-tab-image").click();
  const tabs = providerDialog.getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("End");
  assert.equal(await tabs.last().getAttribute("aria-selected"), "true", "End selects the last Provider tab");
  await page.keyboard.press("Home");
  assert.equal(await tabs.first().getAttribute("aria-selected"), "true", "Home selects the first Provider tab");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await tabs.last().getAttribute("aria-selected"), "true", "ArrowLeft wraps Provider tabs");
  await page.keyboard.press("ArrowRight");
  assert.equal(await tabs.first().getAttribute("aria-selected"), "true", "ArrowRight wraps Provider tabs");
  await page.keyboard.press("Escape");
  await providerDialog.waitFor({ state: "hidden" });
  assert.equal(await providerTrigger.evaluate((element) => document.activeElement === element), true, "Provider dialog restores focus to its trigger");

  const scenePreset = await visiblePanelControl(page, "scene-preset");
  if (viewport.width <= 768) assert.ok((await page.locator(".ai-panel-close").boundingBox())?.height >= 44, "AI panel close keeps the mobile target size");
  await scenePreset.selectOption("wide-2k");
  assert.equal(await page.getByTestId("resolution-model-fallback").count(), 0, "Configured 2K model does not show fallback");
  await scenePreset.selectOption("wide-4k");
  const fallback = page.getByTestId("resolution-model-fallback");
  await fallback.waitFor();
  assert.match(await fallback.innerText(), /4K.*gpt-image-2.*4K/us, "4K fallback names the actual model and preserves the requested tier");
  assert.match(await fallback.getByRole("button").innerText(), /配置高分辨率模型/u, "Editable source exposes the configuration action");
  assert.ok((await fallback.getByRole("button").boundingBox())?.height >= targetSize, "Resolution fallback action keeps the viewport target size");
  await fallback.getByRole("button").click();
  await page.getByTestId("provider-image-panel").waitFor();
  assert.equal(await page.getByTestId("provider-local-model-4k").isVisible(), true, "Editable fallback opens the high-resolution model configuration");
  await page.keyboard.press("Escape");
  await providerDialog.waitFor({ state: "hidden" });

  await page.evaluate(() => {
    window.__referenceOriginalDecode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function decodeFixtureImage() {
      return Promise.reject(new DOMException("fixture decode failure", "EncodingError"));
    };
  });
  const referenceMode = await visiblePanelControl(page, "mode-reference");
  assert.ok((await referenceMode.boundingBox())?.height >= targetSize, "Canvas mode controls keep the viewport target size");
  await referenceMode.click();
  const referenceState = page.getByTestId("reference-state");
  await referenceState.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="reference-state"]')?.getAttribute("data-reference-state") === "error");
  assert.equal(await page.getByTestId("generate-button").getAttribute("data-reference-mode"), "generate", "Decode failure never marks the reference ready");
  await page.evaluate(() => {
    HTMLImageElement.prototype.decode = window.__referenceOriginalDecode;
    delete window.__referenceOriginalDecode;
  });
  await referenceState.getByRole("button", { name: "重新检查" }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="reference-state"]')?.getAttribute("data-reference-state") === "ready");
  await page.getByTestId("mode-text").click();

  await page.evaluate(() => {
    window.__agentOriginalDecode = HTMLImageElement.prototype.decode;
    window.__agentDecodeAttempts = 0;
    HTMLImageElement.prototype.decode = function decodeAgentFixtureImage() {
      if (this.classList.contains("agent-reference-item__image")) {
        window.__agentDecodeAttempts += 1;
        return Promise.reject(new DOMException("fixture Agent decode failure", "EncodingError"));
      }
      return window.__agentOriginalDecode.call(this);
    };
  });
  await page.getByTestId("panel-tab-agent").click();
  await page.getByTestId("agent-parameter-toggle").click();
  if (viewport.width <= 768) {
    const agentModelSettings = page.getByTestId("agent-config-state").locator(".agent-model-pill");
    assert.ok((await agentModelSettings.boundingBox())?.height >= 44, "Agent model settings keeps the mobile target size");
    for (const copy of await agentModelSettings.locator(".agent-model-pill__copy > *").all()) {
      assert.equal(await copy.evaluate((element) => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight), true, "Agent model status remains fully visible on mobile");
    }
    for (const action of await page.locator(".agent-chat-head__actions .agent-icon-button").all()) {
      assert.ok((await action.boundingBox())?.height >= 44, "Agent header actions keep the mobile target size");
    }
    assert.ok((await page.getByTestId("agent-parameter-toggle").boundingBox())?.height >= 44, "Agent parameter trigger keeps the mobile target size");
    assert.ok((await page.getByTestId("agent-size-preset-buttons").getByRole("button").first().boundingBox())?.height >= 44, "Agent size presets keep the mobile target size");
    assert.ok((await page.getByTestId("agent-parameter-popover").locator(".field-control").first().boundingBox())?.height >= 44, "Agent parameter fields keep the mobile target size");
  }
  const agentReferenceItem = page.getByTestId("agent-reference-item").first();
  await agentReferenceItem.waitFor();
  await page.waitForFunction(() => window.__agentDecodeAttempts > 0);
  await page.waitForFunction(() => document.querySelector('[data-testid="agent-reference-item"]')?.getAttribute("data-load-state") === "error");
  assert.doesNotMatch(await page.getByTestId("agent-parameter-popover").innerText(), /将使用 1 \/ \d+ 张/u, "Agent never marks an undecodable reference ready");
  await page.evaluate(() => {
    HTMLImageElement.prototype.decode = window.__agentOriginalDecode;
    delete window.__agentOriginalDecode;
    delete window.__agentDecodeAttempts;
  });
  const agentReferenceRetry = page.getByTestId("agent-reference-warning").getByRole("button", { name: "重新检查" });
  assert.ok((await agentReferenceRetry.boundingBox())?.height >= targetSize, "Agent reference retry keeps the viewport target size");
  await agentReferenceRetry.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="agent-reference-item"]')?.getAttribute("data-load-state") === "ready");
  assert.match(await page.getByTestId("agent-parameter-popover").innerText(), /将使用 1 \/ \d+ 张/u, "Agent marks the reference ready only after successful decode");
  const closeAgentParameters = page.getByTestId("agent-parameter-popover").getByRole("button", { name: "关闭" });
  if (viewport.width <= 768) assert.ok((await closeAgentParameters.boundingBox())?.height >= 44, "Agent parameter close keeps the mobile target size");
  await closeAgentParameters.focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("agent-parameter-popover").waitFor({ state: "hidden" });
  await page.getByTestId("panel-tab-manual").click();
  assert.ok((await page.getByTestId("generation-count-control").getByRole("button").first().boundingBox())?.height >= targetSize, "Canvas quantity controls keep the viewport target size");

  const agentHistoryTrigger = page.getByTestId("agent-history-open");
  await page.getByTestId("panel-tab-agent").click();
  await agentHistoryTrigger.focus();
  await agentHistoryTrigger.click();
  const agentHistoryDialog = page.getByTestId("agent-history-dialog").getByRole("dialog");
  await agentHistoryDialog.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="agent-history-dialog"] [role="dialog"]')?.contains(document.activeElement));
  await agentHistoryDialog.getByRole("alert").waitFor();
  assert.equal(await agentHistoryDialog.getByText("还没有 Agent 历史").count(), 0, "Agent history keeps load failures distinct from genuine empty data");
  assert.equal(await agentHistoryDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true, "Agent history receives initial focus");
  assert.equal(await agentHistoryDialog.evaluate((dialog) => Boolean(dialog.closest("[inert]"))), false, "Agent history stays outside the inert background");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await agentHistoryDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true, "Agent history traps reverse focus traversal");
  await page.keyboard.press("Escape");
  await agentHistoryDialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement === document.querySelector('[data-testid="agent-history-open"]'));
  assert.equal(await agentHistoryTrigger.evaluate((element) => document.activeElement === element), true, "Agent history restores focus to its trigger");

  const agentSkillsTrigger = page.getByTestId("agent-skills-open");
  await agentSkillsTrigger.focus();
  await agentSkillsTrigger.click();
  const agentSkillsDialog = page.getByRole("dialog", { name: "Agent Skill Library" });
  await agentSkillsDialog.waitFor();
  await page.waitForFunction(() => document.querySelector('.agent-skill-dialog')?.contains(document.activeElement));
  assert.equal(await agentSkillsDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true, "Agent skill dialog receives deterministic focus");
  assert.equal(await agentSkillsTrigger.evaluate((element) => Boolean(element.closest("[inert]"))), true, "Agent skill dialog makes the background inert");
  await page.keyboard.press("Escape");
  await agentSkillsDialog.waitFor({ state: "hidden" });
  assert.equal(await agentSkillsTrigger.evaluate((element) => document.activeElement === element), true, "Agent skill dialog restores focus to its trigger");
  await page.getByTestId("panel-tab-manual").click();

  await page.getByTestId("prompt-input").fill("验证 4K 回退历史");
  const generationRequestPromise = page.waitForRequest((request) => request.url().includes("/api/images/generate"));
  await page.getByTestId("generate-button").click();
  const generationRequest = await generationRequestPromise;
  const generationPayload = generationRequest.postDataJSON();
  assert.deepEqual(generationPayload.size, { width: 3840, height: 2160 }, "Generation keeps the requested 4K dimensions");
  const generatedHistory = page.getByTestId("history-record").first();
  await generatedHistory.waitFor();
  assert.match(await generatedHistory.innerText(), /4K.*gpt-image-2.*默认模型/us, "Failed history explains the resolved route and fallback");
  assert.doesNotMatch(await generatedHistory.innerText(), /local-openai|生成源/u, "Failed history hides the internal provider source name");
  const historyModel = generatedHistory.locator(".history-route-metadata dd").filter({ hasText: "gpt-image-2" });
  assert.equal(await historyModel.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getClientRects().length;
  }), 1, "Failed history keeps technical model identifiers on one line");
  assert.match(await generatedHistory.innerText(), /受控上游失败/u, "Failed history keeps the safe error reason");
  assert.match(await generatedHistory.innerText(), /上游重试 1 次/u, "Failed history exposes the actual upstream retry count");
  if (viewport.width <= 768) assert.ok((await generatedHistory.locator(".history-icon-action").first().boundingBox())?.height >= 44, "History actions keep the mobile target size");

  fixture.state.localModel2K = undefined;
  fixture.state.localModel4K = "fixture-image-4k";
  await page.reload();
  const invertedScenePreset = await visiblePanelControl(page, "scene-preset");
  await invertedScenePreset.selectOption("wide-2k");
  assert.match(await page.getByTestId("resolution-model-fallback").innerText(), /2K.*gpt-image-2.*2K/us, "Missing 2K model falls back without changing the tier");
  await invertedScenePreset.selectOption("wide-4k");
  assert.equal(await page.getByTestId("resolution-model-fallback").count(), 0, "Configured 4K model does not show fallback");

  fixture.state.providerMode = "environment";
  fixture.state.hostMode = "standalone";
  await page.goto(`${baseUrl}/`);
  const reloadedScenePreset = await visiblePanelControl(page, "scene-preset");
  await reloadedScenePreset.selectOption("wide-4k");
  const readOnlyFallback = page.getByTestId("resolution-model-fallback");
  await readOnlyFallback.waitFor();
  assert.match(await readOnlyFallback.getByRole("button").innerText(), /查看当前生成源/u, "Read-only source exposes a view-only action");
  await readOnlyFallback.getByRole("button").click();
  const readOnlySourceView = page.getByTestId("provider-image-panel");
  await readOnlySourceView.waitFor();
  assert.match(await readOnlySourceView.innerText(), /环境 OpenAI/u, "Read-only action opens the active environment source view");
}

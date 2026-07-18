import assert from "node:assert/strict";

function waitForPreview(page, assetId) {
  return page.waitForResponse((response) => new URL(response.url()).pathname === `/api/assets/${assetId}/preview`);
}

function viewportTargetSize(viewport) {
  return viewport.width <= 768 ? 44 : 40;
}

async function assertOpenModal(page, dialogTestId, trigger, initialFocusName) {
  await trigger.focus();
  await trigger.click();
  const dialog = page.getByTestId(dialogTestId).locator('[role="dialog"]');
  await dialog.waitFor();
  await page.waitForFunction((testId) => document.querySelector(`[data-testid="${testId}"] [role="dialog"]`)?.contains(document.activeElement), dialogTestId);
  assert.equal(await dialog.evaluate((element) => Boolean(element.closest("[inert]"))), false, `${dialogTestId} stays outside the inert background`);
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true, `${dialogTestId} receives initial focus`);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), initialFocusName, `${dialogTestId} uses deterministic initial focus`);
  return dialog;
}

export async function runCollectionContracts({ baseUrl, fixture, page, viewport }) {
  await page.goto(`${baseUrl}/pool?ui_mode=embedded&contract=keep&token=secret&user_id=42`);
  const poolSearch = page.getByTestId("pool-search");
  const targetSize = viewportTargetSize(viewport);
  assert.ok((await page.getByTestId("nav-gallery").boundingBox())?.height >= targetSize, "top navigation keeps the viewport target size");
  const poolImages = page.locator(".pool-card__image");
  await poolImages.first().waitFor();
  await page.waitForFunction(() => {
    const image = document.querySelector(".pool-card__image");
    return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0;
  });
  const initiallyRequestedPoolImages = new Set(fixture.state.poolImageRequests);
  assert.ok(initiallyRequestedPoolImages.size > 0 && initiallyRequestedPoolImages.size < 36, "Pool lazily requests only the near-viewport image subset");
  const deferredPoolImage = page.waitForResponse((response) => {
    const pathname = new URL(response.url()).pathname;
    return pathname.startsWith("/fixture/pool-image/") && !initiallyRequestedPoolImages.has(pathname);
  });
  await page.getByTestId("pool-card").last().scrollIntoViewIfNeeded();
  await deferredPoolImage;
  assert.ok(fixture.state.poolImageRequests.length > initiallyRequestedPoolImages.size, "Pool requests deferred images when scrolling near them");
  await poolSearch.locator("..").click({ position: { x: 12, y: 20 } });
  assert.equal(await poolSearch.evaluate((element) => document.activeElement === element), true, "the full Pool search shell focuses its input");
  assert.ok((await poolSearch.locator("..").boundingBox())?.height >= targetSize, "Pool search keeps the viewport target size");
  for (const control of await page.locator(".pool-segmented__button, .pool-select-field select, .pool-reset").all()) {
    assert.ok((await control.boundingBox())?.height >= targetSize, "Pool filters keep the viewport target size");
  }
  await poolSearch.fill("不存在的关键词XYZ");
  const poolEmpty = page.getByTestId("pool-empty");
  await poolEmpty.waitFor();
  assert.match(await poolEmpty.innerText(), /不存在的关键词XYZ/u, "Pool no-result copy includes the current keyword");
  await poolSearch.fill("");
  const poolOpen = page.locator('button[aria-label^="打开提示池详情"]').first();
  fixture.state.poolDetailFailure = true;
  await poolOpen.click();
  await page.getByTestId("pool-operation-error").waitFor();
  assert.equal(await page.getByTestId("pool-masonry").isVisible(), true, "Pool keeps primary data visible when detail loading fails");
  fixture.state.poolDetailFailure = false;
  const poolDialog = await assertOpenModal(page, "pool-detail", poolOpen, "收藏");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await poolDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true, "Pool detail keeps reverse focus traversal inside");
  await page.keyboard.press("Escape");
  await poolDialog.waitFor({ state: "hidden" });
  assert.equal(await poolOpen.evaluate((element) => document.activeElement === element), true, "Pool detail restores focus to its trigger");

  fixture.state.poolBrokenImageId = 1;
  await page.reload();
  const poolCardFallback = page.locator(".pool-card .pool-asset-fallback").first();
  await poolCardFallback.waitFor();
  assert.equal(await page.locator("button button").count(), 0, "Pool never nests retry inside its detail trigger");
  const poolCardRetry = poolCardFallback.getByRole("button", { name: "重新检查图片" });
  assert.ok((await poolCardRetry.boundingBox())?.height >= targetSize, "Pool card retry keeps the viewport target size");
  const failedPoolCardRetry = page.waitForResponse((response) => new URL(response.url()).pathname === "/fixture/pool-image/1.png");
  await poolCardRetry.click();
  assert.equal((await failedPoolCardRetry).status(), 404, "Pool card retry observes the failed image response");
  fixture.state.poolBrokenImageId = null;
  const recoveredPoolCardRetry = page.waitForResponse((response) => new URL(response.url()).pathname === "/fixture/pool-image/1.png");
  await poolCardRetry.click();
  assert.equal((await recoveredPoolCardRetry).ok(), true, "Pool card retry observes the recovered image response");
  await poolCardFallback.waitFor({ state: "hidden" });

  fixture.state.poolDetailImageReady = false;
  const recoveredPoolOpen = page.locator('button[aria-label^="打开提示池详情"]').first();
  const brokenPoolDialog = await assertOpenModal(page, "pool-detail", recoveredPoolOpen, "收藏");
  const poolDetailFallback = brokenPoolDialog.locator(".pool-asset-fallback");
  await poolDetailFallback.waitFor();
  const poolDetailRetry = poolDetailFallback.getByRole("button", { name: "重新检查图片" });
  assert.ok((await poolDetailRetry.boundingBox())?.height >= targetSize, "Pool detail retry keeps the viewport target size");
  const failedPoolDetailRetry = page.waitForResponse((response) => new URL(response.url()).pathname === "/fixture/pool-detail.png");
  await poolDetailRetry.click();
  assert.equal((await failedPoolDetailRetry).status(), 404, "Pool detail retry observes the failed image response");
  fixture.state.poolDetailImageReady = true;
  const recoveredPoolDetailRetry = page.waitForResponse((response) => new URL(response.url()).pathname === "/fixture/pool-detail.png");
  await poolDetailRetry.click();
  assert.equal((await recoveredPoolDetailRetry).ok(), true, "Pool detail retry observes the recovered image response");
  await poolDetailFallback.waitFor({ state: "hidden" });
  await page.keyboard.press("Escape");
  await brokenPoolDialog.waitFor({ state: "hidden" });

  fixture.state.favoriteSourceIdsByUserId.set("42", "fixture-prompt");
  await page.evaluate(async () => {
    const { saveHostCredentials } = await import("/src/shared/api/host-token.ts");
    saveHostCredentials("fixture-token-42", "42");
  });
  await page.reload();
  const savedFavoriteButton = page.locator('.pool-favorite-button[data-active="true"]').first();
  await savedFavoriteButton.waitFor();
  await savedFavoriteButton.click();
  const identityPopover = page.getByTestId("favorite-popover");
  await identityPopover.waitFor();
  await page.evaluate(async () => {
    const { saveHostCredentials } = await import("/src/shared/api/host-token.ts");
    saveHostCredentials("fixture-token-43", "43");
    const input = document.querySelector('[data-testid="pool-search"]');
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (input instanceof HTMLInputElement && valueSetter) {
      valueSetter.call(input, "身份边界切换");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
  await identityPopover.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.querySelector('.pool-favorite-button[data-active="true"]') === null);
  assert.equal(await page.getByTestId("favorite-error").count(), 0, "changing identity clears private favorite errors and view state");
  await poolSearch.fill("");
  await page.getByTestId("pool-masonry").waitFor();

  fixture.state.favoriteSourceIdsByUserId.delete("42");
  fixture.state.favoriteMutationDelayMs = 200;
  const identity42Favorites = page.waitForResponse((response) => {
    const request = response.request();
    return new URL(response.url()).pathname === "/api/prompt-favorites" && request.method() === "GET" && request.headers()["new-api-user"] === "42";
  });
  await page.evaluate(async () => {
    const { saveHostCredentials } = await import("/src/shared/api/host-token.ts");
    saveHostCredentials("fixture-token-42", "42");
  });
  await page.locator(".pool-segmented__button").nth(1).click();
  await identity42Favorites;
  const pendingFavoriteResponse = page.waitForResponse((response) => {
    const request = response.request();
    return new URL(response.url()).pathname === "/api/prompt-favorites" && request.method() === "POST";
  });
  await page.locator(".pool-favorite-button").first().click();
  await page.evaluate(async () => {
    const { saveHostCredentials } = await import("/src/shared/api/host-token.ts");
    saveHostCredentials("fixture-token-43", "43");
  });
  await page.locator(".pool-segmented__button").first().click();
  await pendingFavoriteResponse;
  await page.waitForTimeout(20);
  assert.equal(await page.locator('.pool-favorite-button[data-active="true"]').count(), 0, "an old identity mutation cannot refill favorite state");
  assert.equal(await page.getByTestId("pool-message").count(), 0, "an old identity mutation cannot publish a stale success toast");
  fixture.state.favoriteMutationDelayMs = 0;

  fixture.state.favoriteFailure = true;
  await page.reload();
  await page.getByTestId("favorite-error").waitFor();
  assert.equal(await page.getByTestId("pool-masonry").isVisible(), true, "Pool keeps primary data visible when favorites fail");
  fixture.state.favoriteFailure = false;
  fixture.state.poolMode = "empty";
  await page.reload();
  assert.match(await page.getByTestId("pool-empty").innerText(), /提示池暂无内容/u, "Pool distinguishes genuine empty data from filtered results");
  fixture.state.poolMode = "error";
  await page.reload();
  await page.getByTestId("pool-error").waitFor();
  assert.equal(await page.getByTestId("pool-masonry").count(), 0, "Pool page failure does not render stale primary cards");
  assert.equal(await page.getByTestId("pool-empty").count(), 0, "Pool page failure stays distinct from genuine empty data");
  fixture.state.poolMode = "ready";
  await page.reload();

  await page.getByTestId("nav-gallery").click();
  await page.waitForURL(/\/gallery\?ui_mode=embedded&contract=keep$/u);
  assert.equal(new URL(page.url()).searchParams.get("contract"), "keep", "internal navigation preserves unknown runtime query parameters");
  assert.equal(new URL(page.url()).searchParams.has("token"), false, "internal navigation removes the host token from browser history");
  assert.equal(new URL(page.url()).searchParams.has("user_id"), false, "internal navigation removes the host user id from browser history");
  const galleryHistoryLength = await page.evaluate(() => window.history.length);
  await page.getByTestId("nav-gallery").click();
  assert.equal(await page.evaluate(() => window.history.length), galleryHistoryLength, "current-route navigation does not duplicate browser history");
  await page.reload();
  assert.equal(await page.getByTestId("nav-home").count(), 0, "refresh restores embedded mode from the preserved query string");
  const gallerySearch = page.getByTestId("gallery-search");
  await gallerySearch.locator("..").click({ position: { x: 12, y: 20 } });
  assert.equal(await gallerySearch.evaluate((element) => document.activeElement === element), true, "the full Gallery search shell focuses its input");
  assert.ok((await gallerySearch.locator("..").boundingBox())?.height >= targetSize, "Gallery search keeps the viewport target size");
  const galleryFallback = page.locator(".gallery-asset-fallback").first();
  await galleryFallback.waitFor();
  assert.equal(await page.locator("button button").count(), 0, "Gallery never nests its retry action inside an open-image button");
  const galleryRetry = galleryFallback.getByRole("button", { name: "重新检查图片" });
  assert.ok((await galleryRetry.boundingBox())?.height >= (viewport.width === 375 ? 44 : 32), "Gallery retry keeps the viewport target size");
  const galleryFailedRetry = waitForPreview(page, "gallery-asset");
  await galleryRetry.click();
  assert.equal((await galleryFailedRetry).status(), 404, "Gallery retry observes the failed preview response");
  fixture.state.galleryReady = true;
  await page.evaluate(() => {
    window.__galleryOriginalDecode = HTMLImageElement.prototype.decode;
    window.__galleryDecodeAttempts = 0;
    HTMLImageElement.prototype.decode = () => { window.__galleryDecodeAttempts += 1; return Promise.reject(new DOMException("fixture decode failure", "EncodingError")); };
  });
  const galleryDecodeRetry = waitForPreview(page, "gallery-asset");
  await galleryRetry.click();
  await galleryDecodeRetry;
  await page.waitForFunction(() => window.__galleryDecodeAttempts > 0);
  await page.evaluate(() => {
    HTMLImageElement.prototype.decode = window.__galleryOriginalDecode;
    delete window.__galleryOriginalDecode;
    delete window.__galleryDecodeAttempts;
  });
  const galleryRecoveredRetry = waitForPreview(page, "gallery-asset");
  await galleryRetry.click();
  assert.equal((await galleryRecoveredRetry).ok(), true, "Gallery retry observes the recovered preview response");
  await galleryFallback.waitFor({ state: "hidden" });
  const galleryOpen = page.locator('button[aria-label^="打开最新作品详情"]');
  const galleryDialog = await assertOpenModal(page, "gallery-detail", galleryOpen, "关闭");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await galleryDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true, "Gallery detail keeps reverse focus traversal inside");
  const galleryDeleteTrigger = galleryDialog.getByRole("button", { name: "移除" });
  await galleryDeleteTrigger.click();
  const deleteDialog = page.getByTestId("gallery-delete-dialog").locator('[role="dialog"]');
  await deleteDialog.waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="gallery-delete-dialog"] [role="dialog"]')?.contains(document.activeElement));
  assert.equal(await deleteDialog.evaluate((element) => Boolean(element.closest("[inert]"))), false, "Gallery delete confirmation stays outside the inert background");
  assert.equal(await galleryDialog.evaluate((element) => Boolean(element.closest("[inert]"))), true, "Gallery delete confirmation makes the detail dialog inert");
  await page.keyboard.press("Escape");
  await deleteDialog.waitFor({ state: "hidden" });
  assert.equal(await galleryDeleteTrigger.evaluate((element) => document.activeElement === element), true, "Gallery delete confirmation restores focus to its trigger");
  await page.keyboard.press("Escape");
  await galleryDialog.waitFor({ state: "hidden" });
  await page.waitForFunction(() => !document.querySelector("#root")?.hasAttribute("inert"));
  const galleryFocusState = await page.evaluate(() => ({
    activeLabel: document.activeElement?.getAttribute("aria-label") ?? "",
    activeTag: document.activeElement?.tagName ?? "",
    openLabels: Array.from(document.querySelectorAll('button[aria-label*="作品详情"]')).map((element) => element.getAttribute("aria-label"))
  }));
  assert.match(galleryFocusState.activeLabel, /打开最新作品详情/u, `Gallery detail restores focus to its trigger: ${JSON.stringify(galleryFocusState)}`);

  const galleryExportEntry = page.getByRole("button", { name: "批量导出" });
  await galleryExportEntry.click();
  await page.getByRole("button", { name: /选择导出/u }).click();
  fixture.state.galleryExportFailure = true;
  await page.getByRole("button", { name: /导出 ZIP/u }).click();
  await page.getByTestId("gallery-operation-error").waitFor();
  assert.equal(await page.getByTestId("gallery-feature").isVisible(), true, "Gallery keeps primary data visible when export fails");
  fixture.state.galleryExportFailure = false;
  await page.getByRole("button", { name: /删除 Gallery 图片/u }).click();
  await page.getByTestId("gallery-delete-dialog").getByRole("button", { name: "确认移除" }).click();
  await page.getByTestId("gallery-empty").waitFor();
  assert.equal(await page.getByRole("region", { name: "Gallery 批量导出" }).count(), 0, "deleting the final work exits export mode");
  fixture.state.galleryDeleted = false;

  fixture.state.galleryMode = "empty";
  await page.reload();
  const emptyGalleryExportEntry = page.getByRole("button", { name: "批量导出" });
  assert.equal(await emptyGalleryExportEntry.isDisabled(), true, "empty Gallery cannot enter export mode");
  assert.match(await page.getByTestId("gallery-empty").innerText(), /暂无作品/u, "Gallery distinguishes genuine empty data");
  fixture.state.galleryMode = "error";
  await page.reload();
  await page.getByTestId("gallery-error").waitFor();
  assert.equal(await emptyGalleryExportEntry.isDisabled(), true, "Gallery load errors cannot expose an empty export toolbar");
  assert.equal(await page.getByTestId("gallery-empty").count(), 0, "Gallery load errors stay distinct from genuine empty data");
  fixture.state.galleryMode = "ready";
}

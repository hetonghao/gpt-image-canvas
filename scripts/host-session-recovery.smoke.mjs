import assert from "node:assert/strict";
import { createBrowserFixture } from "./web-ui-contracts.fixture.mjs";
import { startBrowserHarness } from "./web-ui-contracts.harness.mjs";

const scenarios = [
  { name: "mobile", viewport: { width: 375, height: 812 } },
  { name: "desktop", viewport: { width: 1280, height: 900 } }
];

async function runScenario({ baseUrl, browser }, scenario, initialFailure) {
  const fixture = createBrowserFixture();
  fixture.state.canvasReady = true;
  const failAllHostSessions = initialFailure;
  let failNextHostSession = initialFailure;
  const page = await browser.newPage({ viewport: scenario.viewport });

  await page.exposeFunction("failNextHostSession", () => {
    failNextHostSession = true;
  });
  await page.addInitScript(() => window.localStorage.setItem("gpt-image-canvas.locale", "zh-CN"));
  await page.route(`${baseUrl}/api/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/host/session" && request.method() === "GET" && (failAllHostSessions || failNextHostSession)) {
      failNextHostSession = false;
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ code: "host_session_required", message: "fixture host session expired" })
      });
      return;
    }
    await fixture.handle(route);
  });

  try {
    await page.goto(`${baseUrl}/canvas?ui_mode=embedded&user_id=42`);
    if (initialFailure) {
      await page.locator(".canvas-host-session-state").waitFor();
      assert.equal(await page.getByTestId("excalidraw-canvas").count(), 0, `${scenario.name}: initial auth failure must not mount Excalidraw`);
      return;
    }

    const editorContainer = page.getByTestId("excalidraw-canvas");
    await editorContainer.waitFor({ state: "attached" });
    await page.evaluate(() => {
      window.__hostSessionEditorContainer = document.querySelector('[data-testid="excalidraw-canvas"]');
      return window.failNextHostSession();
    });
    await page.evaluate(() => window.dispatchEvent(new Event("ai-cove-design:host-credentials-updated")));
    const recoveryOverlay = page.locator('[data-testid="canvas-host-session-overlay"]');
    await recoveryOverlay.waitFor({ state: "visible" });

    assert.equal(await editorContainer.count(), 1, `${scenario.name}: host-session recheck must keep Excalidraw mounted`);
    assert.equal(
      await page.evaluate(() => document.querySelector('[data-testid="excalidraw-canvas"]') === window.__hostSessionEditorContainer),
      true,
      `${scenario.name}: host-session recheck must keep the same editor DOM instance`
    );
    assert.equal(await recoveryOverlay.evaluate((element) => getComputedStyle(element).position), "fixed");
    assert.equal(await page.locator(".app-root").getAttribute("inert"), "");
    await page.waitForFunction(() => document.activeElement?.matches('[data-testid="canvas-host-session-overlay"]'));
    assert.equal(await page.getByText("画布未就绪。", { exact: true }).count(), 0);
  } finally {
    await page.close();
  }
}

const harness = await startBrowserHarness();
try {
  for (const scenario of scenarios) {
    await runScenario(harness, scenario, true);
    await runScenario(harness, scenario, false);
  }
  process.stdout.write("host-session-recovery.smoke.mjs passed (initial block + mounted recovery at 375x812 and 1280x900)\n");
} finally {
  await harness.stop();
}

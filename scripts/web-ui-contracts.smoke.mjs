import { createBrowserFixture } from "./web-ui-contracts.fixture.mjs";
import { runCanvasContracts } from "./web-ui-contracts.canvas-contracts.mjs";
import { runCollectionContracts } from "./web-ui-contracts.collection-contracts.mjs";
import { browserContractViewports, startBrowserHarness } from "./web-ui-contracts.harness.mjs";

const harness = await startBrowserHarness();
const { baseUrl, browser } = harness;

async function runContracts(viewport) {
  const fixture = createBrowserFixture();
  const page = await browser.newPage({ viewport });
  try {
    await page.addInitScript(() => window.localStorage.setItem("gpt-image-canvas.locale", "zh-CN"));
    await page.route(`${baseUrl}/api/**`, fixture.handle);
    await page.route(`${baseUrl}/fixture/**`, fixture.handle);
    const context = { baseUrl, fixture, page, viewport };
    await runCollectionContracts(context);
    await runCanvasContracts(context);
  } finally {
    await page.close();
  }
}

try {
  for (const viewport of browserContractViewports) await runContracts(viewport);
  process.stdout.write(`web-ui-contracts.smoke.mjs passed (${browserContractViewports.map(({ width, height }) => `${width}x${height}`).join(", ")})\n`);
} finally {
  await harness.stop();
}

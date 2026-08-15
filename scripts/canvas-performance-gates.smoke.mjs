import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright-core";
import { createBrowserFixture } from "./web-ui-contracts.fixture.mjs";

const webRoot = new URL("../apps/web/", import.meta.url).pathname;
const distRoot = join(webRoot, "dist");
const kibibyte = 1024;
const criticalPathBudget = 750 * kibibyte;
const initialJavaScriptBudget = 600 * kibibyte;
const fast4G = { latency: 40, downloadThroughput: 1_600_000, uploadThroughput: 750_000 };
const scenarios = [
  { id: "desktop", viewport: { width: 1280, height: 900 }, coldBudget: 5_000, warmBudget: 2_000 },
  { id: "mobile", viewport: { width: 390, height: 844 }, coldBudget: 8_000, warmBudget: 3_000 }
];

const server = await startDistServer();
const browser = await launchBrowser();
try {
  const requestProof = await verifyRouteRequests(browser, server.baseUrl);
  const canvasBuild = await measureCanvasBuild(requestProof.canvasAssets);
  const timings = {};
  for (const scenario of scenarios) {
    timings[scenario.id] = await measureCanvasTiming(browser, server.baseUrl, scenario);
    assert.ok(timings[scenario.id].coldMs <= scenario.coldBudget, `${scenario.id} cold interaction exceeded ${scenario.coldBudget}ms: ${timings[scenario.id].coldMs}ms`);
    assert.ok(timings[scenario.id].warmMs <= scenario.warmBudget, `${scenario.id} warm interaction exceeded ${scenario.warmBudget}ms: ${timings[scenario.id].warmMs}ms`);
  }
  const report = { budgets: { criticalPathGzipBytes: criticalPathBudget, initialJavaScriptGzipBytes: initialJavaScriptBudget }, canvasBuild, requestProof, timings };
  if (process.env.PERF_REPORT_PATH) await writeFile(process.env.PERF_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\ncanvas-performance-gates.smoke.mjs passed\n`);
} finally {
  await browser.close();
  await server.stop();
}

async function verifyRouteRequests(browserInstance, baseUrl) {
  const routes = [
    { id: "home", path: "/", ready: "home-page", standalone: true },
    { id: "pool", path: "/pool", ready: "pool-page", standalone: true },
    { id: "gallery", path: "/gallery", ready: "gallery-page", standalone: true },
    { id: "canvas", path: "/canvas?ui_mode=embedded", ready: "excalidraw-canvas", standalone: false }
  ];
  const result = {};
  for (const route of routes) {
    const context = await browserInstance.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const fixture = createBrowserFixture();
    fixture.state.canvasReady = true;
    if (route.standalone) fixture.state.hostMode = "standalone";
    await installFixture(page, baseUrl, fixture, route.standalone);
    const assets = captureAssets(page, baseUrl);
    await page.goto(`${baseUrl}${route.path}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId(route.ready).waitFor({ state: "visible", timeout: 15_000 });
    if (route.id === "canvas") await waitForCanvasSurface(page, 15_000);
    await page.waitForLoadState("networkidle");
    const paths = assets();
    result[route.id] = paths;
    if (route.id !== "canvas") {
      assert.equal(paths.some((path) => /ExcalidrawCanvas/i.test(path)), false, `${route.id} requested an Excalidraw asset: ${paths.join(", ")}`);
    } else {
      assert.ok(paths.some((path) => /ExcalidrawCanvas-[^/]+\.js$/u.test(path)), "Canvas must request the lazy Excalidraw JavaScript chunk");
      assert.ok(paths.some((path) => /ExcalidrawCanvas-[^/]+\.css$/u.test(path)), "Canvas must request the lazy Excalidraw stylesheet");
      const optional = paths.filter(isOptionalFeatureAsset);
      assert.deepEqual(optional, [], `Canvas preloaded optional feature chunks: ${optional.join(", ")}`);
    }
    await context.close();
  }
  return { home: result.home, pool: result.pool, gallery: result.gallery, canvas: result.canvas, canvasAssets: result.canvas };
}

async function measureCanvasBuild(paths) {
  const initialAssets = [...new Set(paths.filter((path) => /\.(?:js|css)$/u.test(path)))];
  const metrics = await Promise.all(initialAssets.map(async (path) => {
    const file = join(distRoot, path.replace(/^\/+/, ""));
    const compressedBytes = gzipSync(await readFile(file)).byteLength;
    return { path, compressedBytes };
  }));
  const js = metrics.filter(({ path }) => path.endsWith(".js"));
  const total = metrics.reduce((sum, metric) => sum + metric.compressedBytes, 0);
  const maxJavaScript = Math.max(...js.map((metric) => metric.compressedBytes));
  assert.ok(total <= criticalPathBudget, `Canvas initial JS+CSS gzip exceeded ${criticalPathBudget} bytes: ${total}`);
  for (const metric of js) assert.ok(metric.compressedBytes <= initialJavaScriptBudget, `Initial JS chunk exceeded ${initialJavaScriptBudget} bytes: ${metric.path}=${metric.compressedBytes}`);
  return { assets: metrics, totalGzipBytes: total, maxInitialJavaScriptGzipBytes: maxJavaScript };
}

async function measureCanvasTiming(browserInstance, baseUrl, scenario) {
  const context = await browserInstance.newContext({ viewport: scenario.viewport });
  const page = await context.newPage();
  const fixture = createBrowserFixture();
  fixture.state.canvasReady = true;
  await installFixture(page, baseUrl, fixture, false);
  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", { offline: false, ...fast4G });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  const coldMs = await navigateToInteractiveCanvas(page, baseUrl, scenario.viewport);
  await client.send("Network.setCacheDisabled", { cacheDisabled: false });
  const warmMs = await navigateToWarmCanvas(page, baseUrl, scenario.viewport);
  await context.close();
  return { coldMs, warmMs, warmMode: "same-context route revisit", network: fast4G, cpuThrottle: 4 };
}

async function navigateToInteractiveCanvas(page, baseUrl, viewport) {
  await page.goto(`${baseUrl}/canvas?ui_mode=embedded`, { waitUntil: "domcontentloaded" });
  const box = await waitForCanvasSurface(page, 20_000);
  assert.ok(box.width > 0 && box.height > 0, "Canvas surface must expose an interactive area");
  await page.mouse.click(box.x + Math.min(box.width / 2, viewport.width - 1), box.y + Math.min(box.height / 2, viewport.height - 1));
  return page.evaluate(() => {
    const mark = performance.getEntriesByName("canvas-performance-navigation-start")[0];
    return Math.round(performance.now() - (mark?.startTime ?? 0));
  });
}

async function navigateToWarmCanvas(page, baseUrl, viewport) {
  await page.goto(`${baseUrl}/pool`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("pool-page").waitFor({ state: "visible", timeout: 20_000 });
  const startedAt = await page.evaluate(() => performance.now());
  await page.evaluate(() => {
    window.history.pushState(null, "", "/canvas?ui_mode=embedded");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  const box = await waitForCanvasSurface(page, 20_000);
  assert.ok(box.width > 0 && box.height > 0, "Warm canvas surface must expose an interactive area");
  await page.mouse.click(box.x + Math.min(box.width / 2, viewport.width - 1), box.y + Math.min(box.height / 2, viewport.height - 1));
  return Math.round(await page.evaluate((start) => performance.now() - start, startedAt));
}

async function waitForCanvasSurface(page, timeout) {
  await page.getByTestId("canvas-export-controls").waitFor({ state: "attached", timeout });
  const surface = page.getByTestId("excalidraw-canvas");
  await surface.waitFor({ state: "visible", timeout });
  const box = await surface.boundingBox();
  assert.ok(box, "Canvas surface must expose a measurable product-owned area");
  return box;
}

function captureAssets(page, baseUrl) {
  const paths = new Set();
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === baseUrl && url.pathname.startsWith("/assets/") && /\.(?:js|css)$/u.test(url.pathname)) paths.add(url.pathname);
  });
  return () => [...paths];
}

function isOptionalFeatureAsset(path) {
  const file = path.split("/").pop() ?? "";
  if (/^zh-CN(?:-|\.)/u.test(file)) return false;
  return /(?:^|[-_])(?:ar-SA|az-AZ|bg-BG|bn-BD|ca-ES|cs-CZ|da-DK|de-DE|el-GR|en|es-ES|eu-ES|fa-IR|fi-FI|fr-FR|gl-ES|he-IL|hi-IN|hu-HU|id-ID|it-IT|ja-JP|kaa|kab-KAB|kk-KZ|km-KH|ko-KR|ku-TR|lt-LT|lv-LV|mr-IN|my-MM|nb-NO|nl-NL|nn-NO|oc-FR|pa-IN|pl-PL|pt-BR|pt-PT|ro-RO|ru-RU|si-LK|sk-SK|sl-SI|sv-SE|ta-IN|th-TH|tr-TR|uk-UA|vi-VN|zh-HK|zh-TW)(?:[-_.]|$)|(?:mermaid|cytoscape|katex|diagram|graphlib|rough|pica|image-blob-reduce|import|export)(?:[-_.]|$)/iu.test(file);
}

async function installFixture(page, baseUrl, fixture, standalone) {
  await page.addInitScript(() => {
    window.localStorage.setItem("gpt-image-canvas.locale", "zh-CN");
    performance.mark("canvas-performance-navigation-start");
  });
  await page.route(`${baseUrl}/api/**`, fixture.handle);
  await page.route(`${baseUrl}/fixture/**`, fixture.handle);
  if (standalone) {
    await page.route(`${baseUrl}/api/auth/status`, (route) => route.fulfill({ json: { provider: "none", openaiConfigured: false, codex: { available: false }, activeSource: null } }));
  }
}

async function startDistServer() {
  const mime = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
      const relativePath = pathname === "/" || !pathname.includes(".") ? "index.html" : pathname.replace(/^\/+/, "");
      const file = join(distRoot, normalize(relativePath));
      if (relative(distRoot, file).startsWith("..")) throw new Error("Invalid dist path");
      const body = await readFile(file);
      response.writeHead(200, { "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000", "content-type": mime[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((resolve) => server.close(resolve)) };
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: process.env.CHROME_CHANNEL ?? "chrome", headless: true });
  } catch (channelError) {
    try {
      return await chromium.launch({ headless: true });
    } catch (bundledError) {
      throw new AggregateError([channelError, bundledError], "Chrome was not found. Set CHROME_PATH or install Chrome/Playwright Chromium.");
    }
  }
}

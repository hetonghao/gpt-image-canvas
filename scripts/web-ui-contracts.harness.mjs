import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const webRoot = fileURLToPath(new URL("../apps/web/", import.meta.url));

function configuredPort() {
  if (!process.env.SMOKE_WEB_PORT) return undefined;
  if (!/^\d+$/u.test(process.env.SMOKE_WEB_PORT)) throw new Error("SMOKE_WEB_PORT must be an integer from 1 to 65535.");
  const port = Number.parseInt(process.env.SMOKE_WEB_PORT, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMOKE_WEB_PORT must be an integer from 1 to 65535.");
  return port;
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => typeof address === "object" && address ? resolve(address.port) : reject(new Error("Could not allocate a web port.")));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited before becoming ready (${child.exitCode}).`);
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The Vite socket is not accepting requests yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${baseUrl}.`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  if (await Promise.race([exited.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 3_000))])) return;
  child.kill("SIGKILL");
  await exited;
}

async function startWebServer() {
  if (process.env.WEB_BASE_URL) return { baseUrl: process.env.WEB_BASE_URL.replace(/\/+$/u, ""), stop: async () => {} };
  const port = configuredPort() ?? await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const viteEntry = fileURLToPath(new URL("../apps/web/node_modules/vite/bin/vite.js", import.meta.url));
  const child = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1"], {
    cwd: webRoot,
    env: { ...process.env, VITE_DEV_SERVER_PORT: String(port), VITE_API_PROXY_TARGET: "http://127.0.0.1:1" },
    stdio: "ignore"
  });
  const killOnExit = () => child.kill();
  process.once("exit", killOnExit);
  try {
    await waitForServer(baseUrl, child);
  } catch (error) {
    process.removeListener("exit", killOnExit);
    await stopChild(child);
    throw error;
  }
  return {
    baseUrl,
    stop: async () => {
      process.removeListener("exit", killOnExit);
      await stopChild(child);
    }
  };
}

async function launchChrome() {
  const headless = process.env.HEADLESS !== "false";
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, headless });
  try {
    return await chromium.launch({ channel: process.env.CHROME_CHANNEL ?? "chrome", headless });
  } catch (channelError) {
    try {
      return await chromium.launch({ headless });
    } catch (bundledError) {
      throw new AggregateError([channelError, bundledError], "Chrome was not found. Set CHROME_PATH or install Chrome/Playwright Chromium.");
    }
  }
}

export const browserContractViewports = [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }];

export async function startBrowserHarness() {
  const webServer = await startWebServer();
  try {
    const browser = await launchChrome();
    return { baseUrl: webServer.baseUrl, browser, stop: async () => { try { await browser.close(); } finally { await webServer.stop(); } } };
  } catch (error) {
    await webServer.stop();
    throw error;
  }
}

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Hono } from "hono";
import { hostAdapterConfig, runtimePaths } from "../../infrastructure/runtime.js";
import { errorResponse } from "../http/errors.js";

type DesktopAuthSession = {
  token: string;
  userId: string;
  updatedAt: number;
};

type DesktopAuthStore = {
  pending?: {
    nonce: string;
    createdAt: number;
  };
  session?: DesktopAuthSession;
};

const DESKTOP_AUTH_STORE_FILE = resolve(runtimePaths.dataDir, "desktop-auth-session.json");
const NONCE_TTL_MS = 10 * 60 * 1000;

export function registerDesktopAuthRoutes(app: Hono): void {
  app.post("/api/desktop-auth/start", async (c) => {
    if (!isDesktopAuthEnabled()) {
      return c.json(errorResponse("desktop_auth_disabled", "Desktop auth is disabled."), 404);
    }

    const nonce = randomBytes(16).toString("hex");
    const store = await readDesktopAuthStore();
    store.pending = {
      nonce,
      createdAt: Date.now()
    };
    await writeDesktopAuthStore(store);

    const loginUrl = new URL("/desktop-auth", hostAdapterConfig.aiCovePublicBaseUrl);
    loginUrl.searchParams.set("nonce", nonce);
    loginUrl.searchParams.set("redirect_uri", new URL("/api/desktop-auth/callback", c.req.url).toString());

    return c.json({
      loginUrl: loginUrl.toString(),
      nonce
    });
  });

  app.get("/api/desktop-auth/callback", async (c) => {
    if (!isDesktopAuthEnabled()) {
      return c.json(errorResponse("desktop_auth_disabled", "Desktop auth is disabled."), 404);
    }

    const nonce = c.req.query("nonce")?.trim() ?? "";
    const token = c.req.query("token")?.trim() ?? "";
    const userId = c.req.query("user_id")?.trim() ?? "";
    const store = await readDesktopAuthStore();

    if (!isValidPendingNonce(store.pending, nonce)) {
      return c.json(errorResponse("invalid_desktop_auth_nonce", "Desktop auth nonce is invalid or expired."), 400);
    }
    if (!token || !userId) {
      return c.json(errorResponse("invalid_desktop_auth_session", "Desktop auth token and user id are required."), 400);
    }

    store.pending = undefined;
    store.session = {
      token,
      userId,
      updatedAt: Date.now()
    };
    await writeDesktopAuthStore(store);

    return c.html(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AI-Cove-Design</title>
</head>
<body>
  <main>
    <h1>AI-Cove-Design 登录完成</h1>
    <p>可以关闭这个页面并返回桌面端。</p>
  </main>
</body>
</html>`);
  });

  app.get("/api/desktop-auth/session", async (c) => {
    if (!isDesktopAuthEnabled()) {
      return c.json(errorResponse("desktop_auth_disabled", "Desktop auth is disabled."), 404);
    }

    const session = (await readDesktopAuthStore()).session;
    if (!session) {
      return c.json({ authenticated: false });
    }

    return c.json({
      authenticated: true,
      token: session.token,
      userId: session.userId
    });
  });

  app.delete("/api/desktop-auth/session", async (c) => {
    if (!isDesktopAuthEnabled()) {
      return c.json(errorResponse("desktop_auth_disabled", "Desktop auth is disabled."), 404);
    }

    await clearDesktopAuthStore();
    return c.json({ success: true });
  });
}

function isDesktopAuthEnabled(): boolean {
  const value = process.env.DESKTOP_AUTH_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function isValidPendingNonce(pending: DesktopAuthStore["pending"], nonce: string): boolean {
  if (!pending || pending.nonce !== nonce) {
    return false;
  }

  return Date.now() - pending.createdAt <= NONCE_TTL_MS;
}

async function readDesktopAuthStore(): Promise<DesktopAuthStore> {
  try {
    const raw = await readFile(DESKTOP_AUTH_STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as DesktopAuthStore;
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}

async function writeDesktopAuthStore(store: DesktopAuthStore): Promise<void> {
  await mkdir(dirname(DESKTOP_AUTH_STORE_FILE), { recursive: true });
  await writeFile(DESKTOP_AUTH_STORE_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

async function clearDesktopAuthStore(): Promise<void> {
  await rm(DESKTOP_AUTH_STORE_FILE, { force: true });
}

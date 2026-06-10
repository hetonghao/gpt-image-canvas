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
  <title>AI Cove Design 登录完成</title>
  <style>
    :root {
      color: #15110d;
      background: #fff7e6;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 18% 14%, rgb(198 95 50 / 0.13), transparent 30%),
        radial-gradient(circle at 82% 12%, rgb(15 118 110 / 0.13), transparent 28%),
        #fff7e6;
    }

    .desktop-auth-complete {
      width: min(720px, calc(100vw - 32px));
      border: 1px solid #e5d7c3;
      border-radius: 14px;
      background:
        linear-gradient(180deg, rgb(255 255 255 / 0.42), transparent 55%),
        #fffdf8;
      box-shadow: 0 28px 70px rgb(51 36 24 / 0.14);
      padding: clamp(28px, 5vw, 44px);
    }

    .desktop-auth-complete__brand {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 28px;
    }

    .desktop-auth-complete__logo {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      box-shadow: 0 12px 28px rgb(126 50 26 / 0.18);
    }

    .desktop-auth-brand-name {
      position: relative;
      max-width: 100%;
      margin: 0;
      overflow: hidden;
      padding-bottom: 4px;
      color: #15110d;
      font-family: "Bodoni 72", "Didot", "Georgia", ui-serif, serif;
      font-size: 21px;
      font-weight: 900;
      letter-spacing: 0;
      line-height: 0.98;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .desktop-auth-brand-name::after {
      content: "";
      position: absolute;
      right: 2px;
      bottom: 0;
      left: 0;
      height: 3px;
      border-radius: 999px;
      background: linear-gradient(90deg, rgb(198 95 50 / 0.9), rgb(15 118 110 / 0.78));
      transform: skewX(-18deg);
    }

    .desktop-auth-brand-name span {
      display: inline-block;
      vertical-align: baseline;
    }

    .desktop-auth-brand-name__prefix {
      color: #2c211a;
      font-style: italic;
      font-weight: 700;
    }

    .desktop-auth-brand-name__image {
      color: transparent;
      background: linear-gradient(100deg, #7e321a 0%, #c65f32 48%, #0f766e 100%);
      background-clip: text;
      font-size: 1.07em;
      -webkit-background-clip: text;
    }

    .desktop-auth-brand-name__canvas {
      color: #0f5f58;
      font-size: 1.15em;
      text-shadow: 0 1px 0 rgb(231 177 112 / 0.36);
    }

    .desktop-auth-brand-name__space {
      width: 0.18em;
    }

    .desktop-auth-brand-name__space--after-prefix {
      width: 0.34em;
    }

    h1 {
      max-width: 720px;
      margin: 0;
      color: #15110d;
      font-size: clamp(30px, 5vw, 44px);
      font-weight: 950;
      letter-spacing: 0;
      line-height: 1.08;
      text-wrap: balance;
    }

    p {
      max-width: 60ch;
      margin: 16px 0 0;
      color: #5f554b;
      font-size: 16px;
      font-weight: 650;
      line-height: 1.7;
      text-wrap: pretty;
    }

    .desktop-auth-complete__status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 26px;
      border: 1px solid rgb(15 118 110 / 0.22);
      border-radius: 999px;
      background: rgb(15 118 110 / 0.1);
      color: #0f5f58;
      font-size: 14px;
      font-weight: 850;
      line-height: 1;
      padding: 10px 14px;
    }

    .desktop-auth-complete__status::before {
      content: "";
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: #0f766e;
      box-shadow: 0 0 0 4px rgb(15 118 110 / 0.12);
    }
  </style>
</head>
<body>
  <main class="desktop-auth-complete">
    <div class="desktop-auth-complete__brand">
      <img class="desktop-auth-complete__logo" src="/brand-logo.png" alt="" draggable="false">
      <p class="desktop-auth-brand-name" aria-label="AI  Cove Design">
        <span class="desktop-auth-brand-name__prefix">AI</span><span class="desktop-auth-brand-name__space desktop-auth-brand-name__space--after-prefix"> </span><span class="desktop-auth-brand-name__image">Cove</span><span class="desktop-auth-brand-name__space"> </span><span class="desktop-auth-brand-name__canvas">Design</span>
      </p>
    </div>
    <h1>登录完成</h1>
    <p>桌面端已经收到 AI Cove 授权。可以关闭这个页面，回到 AI Cove Design 继续创作。</p>
    <div class="desktop-auth-complete__status">已连接桌面端</div>
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

import { saveHostCredentials } from "../api/host-token";
import { isTauriRuntime } from "./desktop-runtime";

type DesktopAuthSessionResponse =
  | {
      authenticated: true;
      token: string;
      userId: string;
    }
  | {
      authenticated: false;
    };

type DesktopAuthStartResponse = {
  loginUrl: string;
};

export type DesktopAuthLoginOptions = {
  fetcher?: typeof fetch;
  openUrl?: (url: string) => Promise<void>;
};

export type DesktopAuthWaitOptions = {
  fetcher?: typeof fetch;
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (durationMs: number) => Promise<void>;
};

const DEFAULT_AUTH_WAIT_INTERVAL_MS = 2_000;
const DEFAULT_AUTH_WAIT_TIMEOUT_MS = 120_000;

export function isDesktopAuthSupported(): boolean {
  return isTauriRuntime();
}

export async function restoreDesktopAuthSession(fetcher: typeof fetch = fetch): Promise<boolean> {
  const response = await fetcher("/api/desktop-auth/session");
  if (!response.ok) {
    return false;
  }

  const session = (await response.json()) as DesktopAuthSessionResponse;
  if (!session.authenticated) {
    return false;
  }

  saveHostCredentials(session.token, session.userId);
  return true;
}

export async function startDesktopAuthLogin(options: DesktopAuthLoginOptions = {}): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher("/api/desktop-auth/start", {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error("Unable to start AI Cove desktop login.");
  }

  const body = (await response.json()) as DesktopAuthStartResponse;
  if (!body.loginUrl) {
    throw new Error("AI Cove desktop login URL is missing.");
  }

  await (options.openUrl ?? openExternalUrl)(body.loginUrl);
}

export async function waitForDesktopAuthSession(options: DesktopAuthWaitOptions = {}): Promise<boolean> {
  const fetcher = options.fetcher ?? fetch;
  const intervalMs = options.intervalMs ?? DEFAULT_AUTH_WAIT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_AUTH_WAIT_TIMEOUT_MS;
  const sleep = options.sleep ?? ((durationMs: number) => new Promise<void>((resolve) => window.setTimeout(resolve, durationMs)));
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (await restoreDesktopAuthSession(fetcher)) {
      return true;
    }
    await sleep(intervalMs);
  }

  return false;
}

async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

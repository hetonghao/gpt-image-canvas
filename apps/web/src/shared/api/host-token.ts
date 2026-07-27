const HOST_TOKEN_STORAGE_KEY = "ai-cove-design.hostToken";
const HOST_USER_ID_STORAGE_KEY = "ai-cove-design.hostUserId";
const HOST_TOKEN_COOKIE_KEY = "ai_cove_design_access";
const HOST_CREDENTIALS_MESSAGE_TYPE = "ai-cove-design.host-credentials";
const HOST_READY_MESSAGE_TYPE = "ai-cove-design.ready";
export const HOST_CREDENTIALS_UPDATED_EVENT = "ai-cove-design:host-credentials-updated";

let cachedHostToken: string | null | undefined;
let cachedHostUserId: string | null | undefined;

export function hasHostToken(): boolean {
  return Boolean(getHostToken());
}

export function hasHostCredentials(): boolean {
  return Boolean(getHostToken() || getHostUserId());
}

export function saveHostCredentials(token: string, userId: string | number): void {
  const normalizedToken = token.trim();
  const normalizedUserId = String(userId).trim();
  if (!normalizedToken || !normalizedUserId) {
    return;
  }

  cachedHostToken = normalizedToken;
  cachedHostUserId = normalizedUserId;
  persistHostToken(normalizedToken);
  persistHostUserId(normalizedUserId);
}

export function clearHostCredentials(): void {
  cachedHostToken = null;
  cachedHostUserId = null;
  removeStoredHostCredential(HOST_TOKEN_STORAGE_KEY);
  removeStoredHostCredential(HOST_USER_ID_STORAGE_KEY);
}

export function installHostCredentialsMessageBridge(): () => void {
  if (typeof window === "undefined" || window.parent === window) {
    return () => undefined;
  }

  const expectedOrigin = readAuthParentOrigin();
  if (!expectedOrigin) {
    return () => undefined;
  }

  const receiveCredentials = (event: MessageEvent<unknown>): void => {
    if (event.source !== window.parent || event.origin !== expectedOrigin || !isRecord(event.data)) {
      return;
    }

    const token = typeof event.data.token === "string" ? event.data.token.trim() : "";
    const userId = typeof event.data.userId === "string" || typeof event.data.userId === "number" ? String(event.data.userId).trim() : "";
    if (event.data.type !== HOST_CREDENTIALS_MESSAGE_TYPE || !token || !userId) {
      return;
    }

    saveHostCredentials(token, userId);
    window.dispatchEvent(new Event(HOST_CREDENTIALS_UPDATED_EVENT));
  };

  window.addEventListener("message", receiveCredentials);
  window.parent.postMessage({ type: HOST_READY_MESSAGE_TYPE }, expectedOrigin);
  return () => window.removeEventListener("message", receiveCredentials);
}

export function getHostToken(): string | null {
  if (cachedHostToken !== undefined) {
    return cachedHostToken;
  }

  const queryToken = readTokenFromLocation();
  if (queryToken) {
    cachedHostToken = queryToken;
    persistHostToken(queryToken);
    return cachedHostToken;
  }

  cachedHostToken = readStoredHostToken();
  return cachedHostToken;
}

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, withHostAuthorization(input, init));
}

export function withHostTokenParam(url: string): string {
  const token = getHostToken();
  const userId = getHostUserId();
  if ((!token && !userId) || !isLocalApiUrl(url)) {
    return url;
  }

  const nextUrl = new URL(url, window.location.href);
  if (token && !usesCookieHostToken()) {
    nextUrl.searchParams.set("token", token);
  }
  if (userId) {
    nextUrl.searchParams.set("user_id", userId);
  }
  return nextUrl.pathname + nextUrl.search + nextUrl.hash;
}

export function appendHostTokenParam(url: URL): URL {
  const token = getHostToken();
  if (token && !usesCookieHostToken()) {
    url.searchParams.set("token", token);
  }
  const userId = getHostUserId();
  if (userId) {
    url.searchParams.set("user_id", userId);
  }
  return url;
}

function withHostAuthorization(input: RequestInfo | URL, init: RequestInit): RequestInit {
  const token = getHostToken();
  const userId = getHostUserId();
  if ((!token && !userId) || !isLocalApiRequest(input)) {
    return init;
  }

  const headers = new Headers(init.headers);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (userId && !headers.has("New-Api-User")) {
    headers.set("New-Api-User", userId);
  }

  return {
    ...init,
    headers
  };
}

function isLocalApiRequest(input: RequestInfo | URL): boolean {
  if (typeof input === "string") {
    return isLocalApiUrl(input);
  }

  if (input instanceof URL) {
    return input.origin === window.location.origin && input.pathname.startsWith("/api/");
  }

  return isLocalApiUrl(input.url);
}

function isLocalApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith("/api/");
  } catch {
    return url.startsWith("/api/");
  }
}

function readTokenFromLocation(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
}

function readAuthParentOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const raw = new URLSearchParams(window.location.search).get("auth_parent_origin")?.trim();
  if (!raw) {
    return "";
  }

  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

function usesCookieHostToken(): boolean {
  return Boolean(readAuthParentOrigin());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getHostUserId(): string | null {
  if (cachedHostUserId !== undefined) {
    return cachedHostUserId;
  }

  const queryUserId = readUserIdFromLocation();
  if (queryUserId) {
    cachedHostUserId = queryUserId;
    persistHostUserId(queryUserId);
    return cachedHostUserId;
  }

  cachedHostUserId = readStoredHostUserId();
  return cachedHostUserId;
}

function readUserIdFromLocation(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return new URLSearchParams(window.location.search).get("user_id")?.trim() ?? "";
}

function readStoredHostToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage.getItem(HOST_TOKEN_STORAGE_KEY) || window.localStorage.getItem(HOST_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readStoredHostUserId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage.getItem(HOST_USER_ID_STORAGE_KEY) || window.localStorage.getItem(HOST_USER_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistHostToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(HOST_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage failures; the token remains available in memory for this page lifetime.
  }

  try {
    window.localStorage.setItem(HOST_TOKEN_STORAGE_KEY, token);
  } catch {
    // sessionStorage is preferred; localStorage is only a refresh fallback.
  }

  if (usesCookieHostToken()) {
    const secure = new URL(window.location.href).protocol === "https:" ? "; Secure" : "";
    document.cookie = `${HOST_TOKEN_COOKIE_KEY}=${encodeURIComponent(token)}; Path=/api; SameSite=Strict${secure}`;
  }
}

function persistHostUserId(userId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(HOST_USER_ID_STORAGE_KEY, userId);
  } catch {
    // Ignore storage failures; the user id remains available in memory for this page lifetime.
  }

  try {
    window.localStorage.setItem(HOST_USER_ID_STORAGE_KEY, userId);
  } catch {
    // sessionStorage is preferred; localStorage is only a refresh fallback.
  }
}

function removeStoredHostCredential(key: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage failures; in-memory credentials were already cleared.
  }

  try {
    window.localStorage.removeItem(key);
  } catch {
    // sessionStorage is preferred; localStorage is only a refresh fallback.
  }


  if (key === HOST_TOKEN_STORAGE_KEY && usesCookieHostToken()) {
    const secure = new URL(window.location.href).protocol === "https:" ? "; Secure" : "";
    document.cookie = `${HOST_TOKEN_COOKIE_KEY}=; Path=/api; Max-Age=0; SameSite=Strict${secure}`;
  }
}

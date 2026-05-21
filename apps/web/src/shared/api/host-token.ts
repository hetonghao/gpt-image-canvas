const HOST_TOKEN_STORAGE_KEY = "ai-cove-design.hostToken";
const HOST_USER_ID_STORAGE_KEY = "ai-cove-design.hostUserId";

let cachedHostToken: string | null | undefined;
let cachedHostUserId: string | null | undefined;

export function hasHostToken(): boolean {
  return Boolean(getHostToken());
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
  if (token) {
    nextUrl.searchParams.set("token", token);
  }
  if (userId) {
    nextUrl.searchParams.set("user_id", userId);
  }
  return nextUrl.pathname + nextUrl.search + nextUrl.hash;
}

export function appendHostTokenParam(url: URL): URL {
  const token = getHostToken();
  if (token) {
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

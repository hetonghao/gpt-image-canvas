const HOST_TOKEN_STORAGE_KEY = "ai-cove-design.hostToken";

let cachedHostToken: string | null | undefined;

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
  if (!token || !isLocalApiUrl(url)) {
    return url;
  }

  const nextUrl = new URL(url, window.location.href);
  nextUrl.searchParams.set("token", token);
  return nextUrl.pathname + nextUrl.search + nextUrl.hash;
}

export function appendHostTokenParam(url: URL): URL {
  const token = getHostToken();
  if (token) {
    url.searchParams.set("token", token);
  }
  return url;
}

function withHostAuthorization(input: RequestInfo | URL, init: RequestInit): RequestInit {
  const token = getHostToken();
  if (!token || !isLocalApiRequest(input)) {
    return init;
  }

  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
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

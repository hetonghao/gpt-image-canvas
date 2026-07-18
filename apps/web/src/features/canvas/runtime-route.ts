export type AppRoute = "home" | "canvas" | "pool" | "gallery";

const SENSITIVE_RUNTIME_QUERY_KEYS = ["token", "user_id"] as const;

export function isAiCoveEmbeddedRuntime(search = currentSearch()): boolean {
  return new URLSearchParams(search).get("ui_mode") === "embedded";
}

export function routeFromLocation(defaultRoute: AppRoute = "home", pathname = currentPathname()): AppRoute {
  if (pathname === "/canvas") {
    return "canvas";
  }

  if (pathname === "/pool") {
    return "pool";
  }

  return pathname === "/gallery" ? "gallery" : defaultRoute;
}

export function initialRouteForRuntime(pathname: string, search: string): AppRoute {
  return routeFromLocation(isAiCoveEmbeddedRuntime(search) ? "canvas" : "home", pathname);
}

export function initialRouteForCurrentRuntime(): AppRoute {
  return initialRouteForRuntime(currentPathname(), currentSearch());
}

export function pathForRoute(route: AppRoute, search = ""): string {
  const suffix = search && !search.startsWith("?") ? `?${search}` : search;
  if (route === "canvas") {
    return `/canvas${suffix}`;
  }

  if (route === "pool") {
    return `/pool${suffix}`;
  }

  return route === "gallery" ? `/gallery${suffix}` : `/${suffix}`;
}

export function searchForInternalNavigation(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of SENSITIVE_RUNTIME_QUERY_KEYS) {
    params.delete(key);
  }
  const sanitized = params.toString();
  return sanitized ? `?${sanitized}` : "";
}

function currentPathname(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

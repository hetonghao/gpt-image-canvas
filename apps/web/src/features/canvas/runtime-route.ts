export type AppRoute = "home" | "canvas" | "gallery";

export function isAiCoveEmbeddedRuntime(search = currentSearch()): boolean {
  return new URLSearchParams(search).get("ui_mode") === "embedded";
}

export function routeFromLocation(defaultRoute: AppRoute = "home", pathname = currentPathname()): AppRoute {
  if (pathname === "/canvas") {
    return "canvas";
  }

  return pathname === "/gallery" ? "gallery" : defaultRoute;
}

export function initialRouteForRuntime(pathname: string, search: string): AppRoute {
  return routeFromLocation(isAiCoveEmbeddedRuntime(search) ? "canvas" : "home", pathname);
}

export function initialRouteForCurrentRuntime(): AppRoute {
  return initialRouteForRuntime(currentPathname(), currentSearch());
}

export function pathForRoute(route: AppRoute): string {
  if (route === "canvas") {
    return "/canvas";
  }

  return route === "gallery" ? "/gallery" : "/";
}

function currentPathname(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}

function currentSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

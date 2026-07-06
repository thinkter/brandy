import { normalizePathname } from "./path.ts";
import type { Route, RouteDiff, RouteManifest, RouteMatch } from "./types.ts";

export class RouteNotFoundError extends Error {
  readonly name = "RouteNotFoundError";

  constructor(readonly pathname: string) {
    super(`No route matches ${pathname}`);
  }
}

function matches(route: Route, pathname: string): boolean {
  const parts = pathname === "/" ? [] : pathname.slice(1).split("/");
  if (parts.length !== route.segments.length) return false;
  return route.segments.every((segment, index) =>
    (segment.startsWith("[") && segment.endsWith("]")) || segment === parts[index]
  );
}

function paramsFor(route: Route, pathname: string): Record<string, string> {
  const parts = pathname === "/" ? [] : pathname.slice(1).split("/");
  return Object.fromEntries(route.segments.flatMap((segment, index) => {
    if (!segment.startsWith("[") || !segment.endsWith("]")) return [];
    return [[segment.slice(1, -1), decodeURIComponent(parts[index]!)]];
  }));
}

export function matchRoute(manifest: RouteManifest, url: string): RouteMatch {
  const pathname = normalizePathname(url);
  const route = manifest.routes.find((candidate) => matches(candidate, pathname));
  if (!route) throw new RouteNotFoundError(pathname);
  return { route, pathname, params: paramsFor(route, pathname) };
}

/** Computes the layout-chain diff between two already-resolved route matches.
 * Walks the longest common prefix of their layout chains to find the divergence
 * boundary and the fragment chain that must be re-rendered. */
export function diffLayoutChains(current: RouteMatch, target: RouteMatch): RouteDiff {
  const oldLayouts = current.route.layouts;
  const newLayouts = target.route.layouts;
  let shared = 0;
  while (
    shared < oldLayouts.length &&
    shared < newLayouts.length &&
    oldLayouts[shared]!.id === newLayouts[shared]!.id
  ) shared++;

  // Every valid app has a shared root layout. It is the outermost legal target.
  const boundary = newLayouts[Math.max(0, shared - 1)];
  if (!boundary) throw new Error("Routes do not share a root layout");
  return {
    current,
    target,
    boundary,
    chainToRender: newLayouts.slice(shared),
  };
}

/** Pure route-tree diff. The returned boundary and fragment chain are inseparable. */
export function diffRoutes(manifest: RouteManifest, currentURL: string, targetURL: string): RouteDiff {
  const current = matchRoute(manifest, currentURL);
  const target = matchRoute(manifest, targetURL);
  return diffLayoutChains(current, target);
}

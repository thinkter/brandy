import { normalizePathname } from "./path.ts";
import type { Route, RouteDiff, RouteManifest, RouteMatch } from "./types.ts";

export class RouteNotFoundError extends Error {
  readonly name = "RouteNotFoundError";

  constructor(readonly pathname: string) {
    super(`No route matches ${pathname}`);
  }
}

/** Thrown when a path segment contains malformed percent-encoding (e.g. a lone
 * `%`) and cannot be decoded. Callers that sit at the edge of the process
 * (see resolveMatch in src/server.ts) should catch this and respond 400 —
 * it is caller error, not a server fault, so it must never surface as a 500. */
export class MalformedPathError extends Error {
  readonly name = "MalformedPathError";

  constructor(readonly pathname: string) {
    super(`Malformed percent-encoding in ${pathname}`);
  }
}

function matches(route: Route, pathname: string): boolean {
  const parts = pathname === "/" ? [] : pathname.slice(1).split("/");
  if (parts.length !== route.segments.length) return false;
  return route.segments.every((segment, index) =>
    (segment.startsWith("[") && segment.endsWith("]")) || segment === parts[index]
  );
}

/** Decodes each dynamic segment exactly once. `pathname` here is the raw,
 * still-percent-encoded string produced by normalizePathname — this is the
 * only place in the request pipeline that ever calls decodeURIComponent, so a
 * value can't be decoded twice (which would let something like `%2541` slip
 * past a filter as `%41` after a first pass and `A` after a second). */
function paramsFor(route: Route, pathname: string): Record<string, string> {
  const parts = pathname === "/" ? [] : pathname.slice(1).split("/");
  return Object.fromEntries(route.segments.flatMap((segment, index) => {
    if (!segment.startsWith("[") || !segment.endsWith("]")) return [];
    let decoded: string;
    try { decoded = decodeURIComponent(parts[index]!); }
    catch { throw new MalformedPathError(pathname); }
    return [[segment.slice(1, -1), decoded]];
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

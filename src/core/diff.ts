import { normalizePathname } from "./path.ts";
import type { Route, RouteDiff, RouteManifest, RouteMatch } from "./types.ts";

function matches(route: Route, pathname: string): boolean {
  const parts = pathname === "/" ? [] : pathname.slice(1).split("/");
  if (parts.length !== route.segments.length) return false;
  return route.segments.every((segment, index) =>
    (segment.startsWith("[") && segment.endsWith("]")) || segment === parts[index]
  );
}

export function matchRoute(manifest: RouteManifest, url: string): RouteMatch {
  const pathname = normalizePathname(url);
  const route = manifest.routes.find((candidate) => matches(candidate, pathname));
  if (!route) throw new Error(`No route matches ${pathname}`);
  return { route, pathname };
}

/** Pure route-tree diff. The returned boundary and fragment chain are inseparable. */
export function diffRoutes(manifest: RouteManifest, currentURL: string, targetURL: string): RouteDiff {
  const current = matchRoute(manifest, currentURL);
  const target = matchRoute(manifest, targetURL);
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

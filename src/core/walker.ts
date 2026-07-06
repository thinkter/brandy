import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type {
  ActionDefinition, ErrorRenderer, InterceptedRoute, LayoutModule, LayoutNode, LoadingRenderer, NotFoundRenderer,
  PageCache, PageModule, PageNode, Route, RouteManifest, ServerAction,
} from "./types.ts";
import { routePattern } from "./path.ts";

const LAYOUT_FILES = ["layout.tsx", "layout.ts", "layout.jsx", "layout.js"];
const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js"];
const ERROR_FILES = ["error.tsx", "error.ts", "error.jsx", "error.js"];
const NOT_FOUND_FILES = ["not-found.tsx", "not-found.ts", "not-found.jsx", "not-found.js"];
const LOADING_FILES = ["loading.tsx", "loading.ts", "loading.jsx", "loading.js"];
const ACTION_FILES = ["actions.tsx", "actions.ts", "actions.jsx", "actions.js"];

interface InterceptMarker {
  levels: number | "root";
  targetName: string;
}

/** Parses a (.)/(..)/(..)(..)/(...) intercepting-route directory name. The dot-count is
 * relative to the directory the marker itself lives in, matching Next's semantics. */
function parseInterceptMarker(name: string): InterceptMarker | undefined {
  const match = /^(\(\.\)|\(\.\.\.\)|(?:\(\.\.\))+)(.+)$/.exec(name);
  if (!match) return undefined;
  const marker = match[1]!;
  const targetName = match[2]!;
  if (marker === "(.)") return { levels: 0, targetName };
  if (marker === "(...)") return { levels: "root", targetName };
  return { levels: marker.length / 4, targetName };
}

/** Returns true for a route-group directory: a plain `(name)` with one or more word
 * characters, hyphens, or spaces — no dots. Route groups are excluded from the URL path. */
function isRouteGroup(name: string): boolean {
  return /^\([A-Za-z0-9_][A-Za-z0-9_\- ]*\)$/.test(name);
}

/** Returns true for any directory name that opens with `(` but is not recognised as a valid
 * intercept marker or a route group.  Intercept markers always start with `(.`, so a leading
 * `(` followed by a non-dot character is either a route group or something we should reject. */
function isUnknownParenthesized(name: string): boolean {
  return name.startsWith("(") && !isRouteGroup(name) && !parseInterceptMarker(name);
}

interface InterceptCandidate {
  targetPattern: string;
  fromSegments: string[];
  page: PageNode;
}

function sameSegments(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

function firstExisting(directory: string, entries: ReadonlySet<string>, candidates: string[]): string | undefined {
  const name = candidates.find((candidate) => entries.has(candidate));
  return name ? join(directory, name) : undefined;
}

/** Normalizes a page module's `prerender`/`revalidate` exports into a `PageCache`, or
 * `undefined` if neither is declared. `revalidate` implies `prerender`. */
function pageCacheFor(module: Partial<PageModule>, pageFile: string): PageCache | undefined {
  if (module.prerender === undefined && module.revalidate === undefined) return undefined;
  if (module.prerender !== undefined && typeof module.prerender !== "boolean") throw new TypeError(`${pageFile} exports \`prerender\`, which must be a boolean`);
  if (module.revalidate !== undefined && (typeof module.revalidate !== "number" || !Number.isFinite(module.revalidate) || module.revalidate < 0)) {
    throw new TypeError(`${pageFile} exports \`revalidate\`, which must be a non-negative number of seconds`);
  }
  if (module.prerender === false && module.revalidate === undefined) return undefined;
  return { revalidateSeconds: module.revalidate ?? null };
}

let importVersion = "";

/** Tracks which action path each handler function has already been assigned, so repeated
 * manifest builds (e.g. overlapping dev rebuilds importing the same cached module) don't
 * blindly re-run `Object.defineProperty` on a shared function object, and so two different
 * routes accidentally resolving to the same handler identity fail loudly instead of one
 * path silently overwriting the other. */
const actionPathsByHandler = new WeakMap<Function, string>();

/** `@kitajs/html` (the JSX runtime app code imports directly) stringifies attribute values
 * with a plain `value.toString()` call when rendering `action={handler}`. Brandy never sees
 * that call, so the only way to make a handler render as its `/_brandy/actions/...` URL is to
 * override `toString` on the function object itself rather than on some wrapper we control. */
function bindActionPath(handler: Function, path: string): void {
  const existing = actionPathsByHandler.get(handler);
  if (existing === path) return;
  if (existing !== undefined) {
    throw new Error(`Server action handler is already bound to ${existing}; cannot also bind it to ${path}. Each action must be a distinct function.`);
  }
  actionPathsByHandler.set(handler, path);
  Object.defineProperty(handler, "toString", { configurable: true, value: () => path });
}

async function importModule(file: string): Promise<Record<string, unknown>> {
  return import(`${file}${importVersion}`) as Promise<Record<string, unknown>>;
}

async function loadDefault<T extends Function>(file: string | undefined, kind: string): Promise<T | undefined> {
  if (!file) return undefined;
  const module = await importModule(file) as { default?: T };
  if (typeof module.default !== "function") throw new TypeError(`${file} must default-export a ${kind} function`);
  return module.default;
}

async function loadLayout(
  file: string,
  directory: string,
  id: string,
  renderError?: ErrorRenderer,
  renderNotFound?: NotFoundRenderer,
  renderLoading?: LoadingRenderer,
): Promise<LayoutNode> {
  const module = await importModule(file) as Partial<LayoutModule>;
  if (typeof module.default !== "function") throw new TypeError(`${file} must default-export a layout function`);
  return { id, directory, file, render: module.default, load: module.load, metadata: module.metadata, renderError, renderNotFound, renderLoading };
}

async function loadActions(file: string | undefined, segmentPath: string, actions: Map<string, ActionDefinition>): Promise<void> {
  if (!file) return;
  const module = await importModule(file);
  const canonicalModule = importVersion
    ? await import(file) as Record<string, unknown>
    : module;
  for (const [name, value] of Object.entries(module)) {
    if (name === "default" || typeof value !== "function") continue;
    const handler = value as ServerAction;
    const id = `${segmentPath || "root"}:${name}`;
    const path = `/_brandy/actions/${Buffer.from(id).toString("base64url")}`;
    bindActionPath(handler, path);
    const canonicalHandler = canonicalModule[name];
    if (typeof canonicalHandler === "function" && canonicalHandler !== handler) {
      bindActionPath(canonicalHandler, path);
    }
    actions.set(path, { id, path, segmentPath, file, name, handler });
  }
}

async function walkDirectory(
  directory: string,
  segments: string[],
  inheritedLayouts: LayoutNode[],
  inheritedError: ErrorRenderer | undefined,
  inheritedNotFound: NotFoundRenderer | undefined,
  routes: Route[],
  actions: Map<string, ActionDefinition>,
  interceptFrom: string[] | undefined,
  intercepted: InterceptCandidate[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = new Set(entries.map((entry) => entry.name));
  const layoutFile = firstExisting(directory, names, LAYOUT_FILES);
  const pageFile = firstExisting(directory, names, PAGE_FILES);
  const errorFile = firstExisting(directory, names, ERROR_FILES);
  const notFoundFile = firstExisting(directory, names, NOT_FOUND_FILES);
  const loadingFile = firstExisting(directory, names, LOADING_FILES);
  const actionsFile = firstExisting(directory, names, ACTION_FILES);
  const ownError = await loadDefault<ErrorRenderer>(errorFile, "error boundary");
  const ownNotFound = await loadDefault<NotFoundRenderer>(notFoundFile, "not-found");
  // loading.tsx is intentionally not inherited like error/not-found: it only applies to nodes
  // created in this exact directory, not threaded down to descendants that lack their own.
  const ownLoading = await loadDefault<LoadingRenderer>(loadingFile, "loading");
  const renderError = ownError ?? inheritedError;
  const renderNotFound = ownNotFound ?? inheritedNotFound;
  const segmentPath = segments.join("/");
  await loadActions(actionsFile, segmentPath, actions);

  const layoutId = segments.length === 0 ? "root" : segmentPath;
  const layouts = layoutFile
    ? [...inheritedLayouts, await loadLayout(layoutFile, directory, layoutId, renderError, renderNotFound, ownLoading)]
    : inheritedLayouts;

  if (pageFile) {
    const module = await importModule(pageFile) as Partial<PageModule>;
    if (typeof module.default !== "function") throw new TypeError(`${pageFile} must default-export a page function`);
    const pattern = routePattern(segments);
    const cache = pageCacheFor(module, pageFile);
    if (cache && (ownLoading || layouts.some((layout) => layout.renderLoading))) {
      throw new Error(`${pageFile} declares \`prerender\`/\`revalidate\`, but the route also has a \`loading.tsx\` boundary — caching and streaming are mutually exclusive`);
    }
    const page: PageNode = {
      id: `${segmentPath || "root"}/page`, directory, file: pageFile, render: module.default,
      load: module.load, metadata: module.metadata, renderError, renderNotFound, renderLoading: ownLoading, cache,
    };
    if (interceptFrom) {
      intercepted.push({ targetPattern: pattern, fromSegments: interceptFrom, page });
    } else {
      routes.push({ id: pattern, pattern, segments, layouts, page, pageFile, renderPage: module.default });
    }
  }

  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  await Promise.all(directories.map(async (entry) => {
    // Route groups — (name) directories — are transparent to the URL: we descend into them
    // without appending any segment. Intercepting markers inside a route group are still
    // recognised normally.
    if (isRouteGroup(entry.name)) {
      await walkDirectory(join(directory, entry.name), segments, layouts, renderError, renderNotFound, routes, actions, interceptFrom, intercepted);
      return;
    }
    // Any other parenthesised name that is not a valid intercept marker is an error.
    // isUnknownParenthesized already excludes route groups and valid markers, so this
    // catches things like "(marketing-2)" (digits-only groups are allowed) but would
    // trip on, e.g., "(bad name!)" or a bare "()".
    if (isUnknownParenthesized(entry.name)) {
      throw new Error(`Directory "${entry.name}" in ${directory} uses parentheses but is not a recognised intercept marker (e.g. (.)name) or route group (e.g. (marketing)). Rename it or wrap it in a valid route-group name.`);
    }
    // Intercepting markers are only recognized outside an existing intercepting subtree —
    // a marker nested inside another marker's directory is not supported.
    const marker = !interceptFrom ? parseInterceptMarker(entry.name) : undefined;
    if (marker) {
      let virtualBase: string[];
      if (marker.levels === "root") {
        virtualBase = [];
      } else {
        if (marker.levels > segments.length) {
          throw new Error(`Intercepting route "${entry.name}" in ${directory} goes up ${marker.levels} level(s), but only ${segments.length} are available`);
        }
        virtualBase = segments.slice(0, segments.length - marker.levels);
      }
      const virtualSegments = [...virtualBase, marker.targetName];
      await walkDirectory(join(directory, entry.name), virtualSegments, layouts, renderError, renderNotFound, routes, actions, segments, intercepted);
      return;
    }
    await walkDirectory(
      join(directory, entry.name), [...segments, entry.name], layouts, renderError, renderNotFound, routes, actions, interceptFrom, intercepted,
    );
  }));
}

export async function buildManifest(appDirectory: string, cacheBust?: string): Promise<RouteManifest> {
  importVersion = cacheBust ? `?brandy=${encodeURIComponent(cacheBust)}` : "";
  const appDir = resolve(appDirectory);
  const routes: Route[] = [];
  const actions = new Map<string, ActionDefinition>();
  const intercepted: InterceptCandidate[] = [];
  await walkDirectory(appDir, [], [], undefined, undefined, routes, actions, undefined, intercepted);
  routes.sort((a, b) => {
    // Compare per-segment: at the first position where the two patterns differ,
    // a static segment beats a dynamic one (Next.js static-first-per-segment rule).
    const len = Math.min(a.segments.length, b.segments.length);
    for (let i = 0; i < len; i++) {
      const dynA = a.segments[i]!.startsWith("[");
      const dynB = b.segments[i]!.startsWith("[");
      if (dynA !== dynB) return dynA ? 1 : -1;
    }
    // All compared segments are equal in specificity; longer route is more specific.
    return b.segments.length - a.segments.length;
  });
  if (routes.length === 0) throw new Error(`No page files found under ${appDir}`);
  for (const route of routes) {
    if (route.layouts.length === 0) {
      const shown = relative(process.cwd(), route.pageFile).split(sep).join("/");
      throw new Error(`Route ${shown} has no ancestor layout; app/layout is required`);
    }
  }
  for (const candidate of intercepted) {
    const target = routes.find((route) => route.pattern === candidate.targetPattern);
    if (!target) {
      throw new Error(`Intercepting route for "${candidate.targetPattern}" has no matching standalone route. Add app${candidate.targetPattern === "/" ? "" : candidate.targetPattern}/page.tsx or remove the intercepting directory.`);
    }
    const entries: InterceptedRoute[] = target.interceptedBy ?? (target.interceptedBy = []);
    if (entries.some((entry) => sameSegments(entry.fromSegments, candidate.fromSegments))) {
      throw new Error(`Multiple intercepting routes for "${candidate.targetPattern}" declare the same source location "/${candidate.fromSegments.join("/")}"`);
    }
    entries.push({ fromSegments: candidate.fromSegments, page: candidate.page });
  }
  return { appDir, routes, actions, rootNotFound: routes[0]?.layouts[0]?.renderNotFound };
}

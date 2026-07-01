import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type {
  ActionDefinition, ErrorRenderer, InterceptedRoute, LayoutModule, LayoutNode, LoadingRenderer, NotFoundRenderer,
  PageModule, PageNode, Route, RouteManifest, ServerAction,
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

let importVersion = "";

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
    Object.defineProperty(handler, "toString", { configurable: true, value: () => path });
    const canonicalHandler = canonicalModule[name];
    if (typeof canonicalHandler === "function" && canonicalHandler !== handler) {
      Object.defineProperty(canonicalHandler, "toString", { configurable: true, value: () => path });
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
    const page: PageNode = {
      id: `${segmentPath || "root"}/page`, directory, file: pageFile, render: module.default,
      load: module.load, metadata: module.metadata, renderError, renderNotFound, renderLoading: ownLoading,
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
    const dynamicA = a.segments.filter((segment) => segment.startsWith("[")).length;
    const dynamicB = b.segments.filter((segment) => segment.startsWith("[")).length;
    return dynamicA - dynamicB || b.segments.length - a.segments.length || a.pattern.localeCompare(b.pattern);
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

import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type {
  ActionDefinition, ErrorRenderer, LayoutModule, LayoutNode, NotFoundRenderer,
  PageModule, PageNode, Route, RouteManifest, ServerAction,
} from "./types.ts";
import { routePattern } from "./path.ts";

const LAYOUT_FILES = ["layout.tsx", "layout.ts", "layout.jsx", "layout.js"];
const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js"];
const ERROR_FILES = ["error.tsx", "error.ts", "error.jsx", "error.js"];
const NOT_FOUND_FILES = ["not-found.tsx", "not-found.ts", "not-found.jsx", "not-found.js"];
const ACTION_FILES = ["actions.tsx", "actions.ts", "actions.jsx", "actions.js"];

async function firstExisting(directory: string, candidates: string[]): Promise<string | undefined> {
  const entries = new Set(await readdir(directory));
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
): Promise<LayoutNode> {
  const module = await importModule(file) as Partial<LayoutModule>;
  if (typeof module.default !== "function") throw new TypeError(`${file} must default-export a layout function`);
  return { id, directory, file, render: module.default, load: module.load, metadata: module.metadata, renderError, renderNotFound };
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
): Promise<void> {
  const [layoutFile, pageFile, errorFile, notFoundFile, actionsFile] = await Promise.all([
    firstExisting(directory, LAYOUT_FILES), firstExisting(directory, PAGE_FILES), firstExisting(directory, ERROR_FILES),
    firstExisting(directory, NOT_FOUND_FILES), firstExisting(directory, ACTION_FILES),
  ]);
  const ownError = await loadDefault<ErrorRenderer>(errorFile, "error boundary");
  const ownNotFound = await loadDefault<NotFoundRenderer>(notFoundFile, "not-found");
  const renderError = ownError ?? inheritedError;
  const renderNotFound = ownNotFound ?? inheritedNotFound;
  const segmentPath = segments.join("/");
  await loadActions(actionsFile, segmentPath, actions);

  const layoutId = segments.length === 0 ? "root" : segmentPath;
  const layouts = layoutFile
    ? [...inheritedLayouts, await loadLayout(layoutFile, directory, layoutId, renderError, renderNotFound)]
    : inheritedLayouts;

  if (pageFile) {
    const module = await importModule(pageFile) as Partial<PageModule>;
    if (typeof module.default !== "function") throw new TypeError(`${pageFile} must default-export a page function`);
    const pattern = routePattern(segments);
    const page: PageNode = {
      id: `${segmentPath || "root"}/page`, directory, file: pageFile, render: module.default,
      load: module.load, metadata: module.metadata, renderError, renderNotFound,
    };
    routes.push({ id: pattern, pattern, segments, layouts, page, pageFile, renderPage: module.default });
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  await Promise.all(directories.map((entry) => walkDirectory(
    join(directory, entry.name), [...segments, entry.name], layouts, renderError, renderNotFound, routes, actions,
  )));
}

export async function buildManifest(appDirectory: string, cacheBust?: string): Promise<RouteManifest> {
  importVersion = cacheBust ? `?brandy=${encodeURIComponent(cacheBust)}` : "";
  const appDir = resolve(appDirectory);
  const routes: Route[] = [];
  const actions = new Map<string, ActionDefinition>();
  await walkDirectory(appDir, [], [], undefined, undefined, routes, actions);
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
  return { appDir, routes, actions, rootNotFound: routes[0]?.layouts[0]?.renderNotFound };
}

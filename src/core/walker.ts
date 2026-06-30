import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { LayoutModule, LayoutNode, PageModule, Route, RouteManifest } from "./types.ts";
import { routePattern } from "./path.ts";

const LAYOUT_FILES = ["layout.tsx", "layout.ts", "layout.jsx", "layout.js"];
const PAGE_FILES = ["page.tsx", "page.ts", "page.jsx", "page.js"];

async function firstExisting(directory: string, candidates: string[]): Promise<string | undefined> {
  const entries = new Set(await readdir(directory));
  const name = candidates.find((candidate) => entries.has(candidate));
  return name ? join(directory, name) : undefined;
}

async function loadLayout(file: string, id: string): Promise<LayoutNode> {
  const module = await import(file) as Partial<LayoutModule>;
  if (typeof module.default !== "function") {
    throw new TypeError(`${file} must default-export a layout function`);
  }
  return { id, file, render: module.default };
}

async function walkDirectory(
  appDir: string,
  directory: string,
  segments: string[],
  inheritedLayouts: LayoutNode[],
  routes: Route[],
): Promise<void> {
  const layoutFile = await firstExisting(directory, LAYOUT_FILES);
  const layoutId = segments.length === 0 ? "root" : segments.join("/");
  const layouts = layoutFile
    ? [...inheritedLayouts, await loadLayout(layoutFile, layoutId)]
    : inheritedLayouts;

  const pageFile = await firstExisting(directory, PAGE_FILES);
  if (pageFile) {
    const module = await import(pageFile) as Partial<PageModule>;
    if (typeof module.default !== "function") {
      throw new TypeError(`${pageFile} must default-export a page function`);
    }
    const pattern = routePattern(segments);
    routes.push({
      id: pattern,
      pattern,
      segments,
      layouts,
      pageFile,
      renderPage: module.default,
    });
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));
  await Promise.all(directories.map((entry) =>
    walkDirectory(appDir, join(directory, entry.name), [...segments, entry.name], layouts, routes)
  ));
}

export async function buildManifest(appDirectory: string): Promise<RouteManifest> {
  const appDir = resolve(appDirectory);
  const routes: Route[] = [];
  await walkDirectory(appDir, appDir, [], [], routes);
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
  return { appDir, routes };
}

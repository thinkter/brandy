import { NotFoundError } from "./control.ts";
import { escapeAttribute, slotId } from "./path.ts";
import type {
  LayoutNode, LoadedRoute, Metadata, MetadataExport, PageNode, RenderContext,
  RenderedRoute, RenderOptions, RequestContext, Route, RouteDiff, RouteMatch,
} from "./types.ts";

type RenderNode = LayoutNode | PageNode;

function outlet(layout: LayoutNode, children: string): JSX.Element {
  return `<div id="${slotId(layout.id)}" data-brandy-slot>${children}</div>` as JSX.Element;
}

function context(match: RouteMatch, request: Request): RequestContext {
  return { params: match.params, request, url: new URL(request.url) };
}

async function resolveMetadata<T>(value: MetadataExport<T> | undefined, props: RenderContext<T>): Promise<Metadata> {
  if (!value) return {};
  return typeof value === "function" ? await value(props) : value;
}

function mergeMetadata(entries: Metadata[]): Metadata {
  const result: Metadata = { meta: {} };
  for (const entry of entries) {
    if (entry.title !== undefined) result.title = entry.title;
    Object.assign(result.meta!, entry.meta);
  }
  return result;
}

async function loadNodes(match: RouteMatch, request: Request, nodes: RenderNode[]): Promise<LoadedRoute> {
  const base = context(match, request);
  const settled = await Promise.allSettled(nodes.map((node) => node.load?.(base)));
  const data = new Map<string, unknown>();
  for (let index = 0; index < nodes.length; index++) {
    const result = settled[index]!;
    if (result.status === "rejected") throw Object.assign(result.reason instanceof Error ? result.reason : new Error(String(result.reason)), { brandyNode: nodes[index] });
    data.set(nodes[index]!.id, result.value);
  }
  const metadata = await Promise.all(nodes.map((node) => resolveMetadata(node.metadata, { ...base, data: data.get(node.id) })));
  return { match, data, metadata: mergeMetadata(metadata) };
}

async function wrap(
  children: string,
  layouts: LayoutNode[],
  loaded: LoadedRoute,
  request: Request,
): Promise<string> {
  let html = children;
  const base = context(loaded.match, request);
  for (let index = layouts.length - 1; index >= 0; index--) {
    const layout = layouts[index]!;
    try {
      html = String(await layout.render({ ...base, data: loaded.data.get(layout.id), children: outlet(layout, html) }));
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { brandyNode: layout });
    }
  }
  return html;
}

function nearestRenderer<T extends "renderError" | "renderNotFound">(nodes: RenderNode[], from: number, key: T): RenderNode[T] | undefined {
  for (let index = from; index >= 0; index--) {
    const renderer = nodes[index]?.[key];
    if (renderer) return renderer;
  }
  return undefined;
}

async function renderPipeline(match: RouteMatch, request: Request, layouts: LayoutNode[], options: RenderOptions = {}): Promise<RenderedRoute> {
  const nodes: RenderNode[] = [...layouts, match.route.page];
  const base = context(match, request);
  try {
    const loaded = await loadNodes(match, request, nodes);
    let page: string;
    try {
      page = String(await match.route.page.render({ ...base, data: loaded.data.get(match.route.page.id) }));
    } catch (error) {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { brandyNode: match.route.page });
    }
    return { html: await wrap(page, layouts, loaded, request), metadata: loaded.metadata, status: 200 };
  } catch (error) {
    const failed = (error as { brandyNode?: RenderNode }).brandyNode;
    const index = Math.max(0, failed ? nodes.indexOf(failed) : nodes.length - 1);
    if (error instanceof NotFoundError) {
      const renderer = nearestRenderer(nodes, index, "renderNotFound");
      if (!renderer) throw error;
      const html = String(await renderer(base));
      const safeLayouts = layouts.slice(0, Math.min(index + 1, layouts.length));
      const loaded: LoadedRoute = { match, data: new Map(), metadata: {} };
      return { html: await wrap(html, safeLayouts, loaded, request), metadata: {}, status: 404 };
    }
    const renderer = nearestRenderer(nodes, index, "renderError");
    if (!renderer) throw error;
    const html = String(await renderer({ ...base, error, dev: options.dev === true }));
    const safeLayouts = layouts.slice(0, Math.min(index, layouts.length));
    const loaded: LoadedRoute = { match, data: new Map(), metadata: {} };
    return { html: await wrap(html, safeLayouts, loaded, request), metadata: {}, status: 500 };
  }
}

function metaTags(metadata: Metadata): string {
  const tags: string[] = [];
  if (metadata.title !== undefined) tags.push(`<title data-brandy-metadata>${escapeAttribute(metadata.title)}</title>`);
  for (const [name, value] of Object.entries(metadata.meta ?? {})) {
    const attributes = typeof value === "string" ? { name, content: value } : value;
    tags.push(`<meta data-brandy-metadata ${Object.entries(attributes).map(([key, item]) => `${escapeAttribute(key)}="${escapeAttribute(item)}"`).join(" ")}>`);
  }
  return tags.join("");
}

export function injectMetadata(document: string, metadata: Metadata): string {
  const tags = metaTags(metadata);
  return document.includes("</head>") ? document.replace("</head>", `${tags}</head>`) : `${tags}${document}`;
}

export function metadataSwap(metadata: Metadata): string {
  return `<template data-brandy-head>${metaTags(metadata)}</template>`;
}

export async function renderFullMatch(match: RouteMatch, request: Request, options: RenderOptions = {}): Promise<RenderedRoute> {
  return renderPipeline(match, request, match.route.layouts, options);
}

export async function renderFragmentMatch(diff: RouteDiff, request: Request, options: RenderOptions = {}): Promise<RenderedRoute> {
  const rendered = await renderPipeline(diff.target, request, diff.chainToRender, options);
  const sharedCount = diff.target.route.layouts.length - diff.chainToRender.length;
  const sharedStatic = diff.target.route.layouts.slice(0, sharedCount)
    .flatMap((layout) => layout.metadata && typeof layout.metadata !== "function" ? [layout.metadata] : []);
  rendered.metadata = mergeMetadata([...sharedStatic, rendered.metadata]);
  return rendered;
}

// Backward-compatible low-level helpers retained for P0 consumers.
export async function renderFull(route: Route): Promise<string> {
  const match: RouteMatch = { route, pathname: route.pattern, params: {} };
  return (await renderFullMatch(match, new Request(`http://brandy.local${route.pattern}`))).html;
}

export async function renderFragment(diff: RouteDiff): Promise<string> {
  return (await renderFragmentMatch(diff, new Request(`http://brandy.local${diff.target.pathname}`))).html;
}

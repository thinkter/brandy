import { NotFoundError } from "./control.ts";
import { findClosingTag, insertBeforeClosingTag } from "./html.ts";
import { createLoaderMemoizationScope, type LoaderMemoizationScope } from "./memo.ts";
import { escapeAttribute, slotId, streamId } from "./path.ts";
import type {
  LayoutNode, LoadedRoute, Metadata, MetadataExport, PageNode, RenderContext,
  RenderedRoute, RenderOptions, RequestContext, Route, RouteDiff, RouteMatch, SyncRenderedRoute,
} from "./types.ts";

type RenderNode = LayoutNode | PageNode;
type RenderMode = "fragment" | "document";

const STREAM_BOUNDARY = "<!--brandy:stream-boundary-->";
const ERROR_METADATA: Metadata = { title: "Error" };
const NOT_FOUND_METADATA: Metadata = { title: "Not Found" };

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

function completedMetadata(match: RouteMatch, rendered: Pick<SyncRenderedRoute, "metadata" | "status">, inherited: Metadata[]): Metadata {
  if (rendered.status === 404) return NOT_FOUND_METADATA;
  if (rendered.status >= 500) return ERROR_METADATA;
  if (match.missing && match.route.page.metadata === undefined) return NOT_FOUND_METADATA;
  return mergeMetadata([...inherited, rendered.metadata]);
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

/** The original synchronous render pipeline. Always resolves; never returns a stream. */
async function renderPipelineCore(match: RouteMatch, request: Request, layouts: LayoutNode[], options: RenderOptions = {}): Promise<Omit<SyncRenderedRoute, "kind">> {
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
      return { html: await wrap(html, safeLayouts, loaded, request), metadata: NOT_FOUND_METADATA, status: 404 };
    }
    const renderer = nearestRenderer(nodes, index, "renderError");
    if (!renderer) throw error;
    const html = String(await renderer({ ...base, error, dev: options.dev === true }));
    const safeLayouts = layouts.slice(0, Math.min(index, layouts.length));
    const loaded: LoadedRoute = { match, data: new Map(), metadata: {} };
    return { html: await wrap(html, safeLayouts, loaded, request), metadata: ERROR_METADATA, status: 500 };
  }
}

function findStreamingIndex(nodes: RenderNode[], minIndex: number): number {
  for (let index = nodes.length - 1; index >= minIndex; index--) {
    if (nodes[index]?.renderLoading) return index;
  }
  return -1;
}

/** A general-purpose named-anchor out-of-band swap: `<template data-brandy-stream-target="id">`,
 * applied client-side by replacing the children of `document.getElementById(id)`. Used for
 * streaming's deferred content, and reused as-is by intercepting routes to clear the modal
 * outlet on ordinary navigations — both are the same "swap this named anchor" primitive. */
export function streamSwap(anchorId: string, html: string): string {
  return `<template data-brandy-stream-target="${escapeAttribute(anchorId)}">${html}</template>`;
}

/** Escapes "</" so a real "</script>" inside serialized content can never close the wrapping <script> tag early. */
function inlineScript(body: string): string {
  return `<script>${body.replace(/<\//g, "<\\/")}</script>`;
}

function inlineSwap(anchorId: string, html: string): string {
  return inlineScript(`document.getElementById(${JSON.stringify(anchorId)}).innerHTML=${JSON.stringify(html)};`);
}

function inlineMetaSwap(metadata: Metadata): string {
  const tags = metaTags(metadata);
  if (!tags) return "";
  return inlineScript(`document.querySelectorAll("[data-brandy-metadata]").forEach(node=>node.remove());document.head.insertAdjacentHTML("beforeend",${JSON.stringify(tags)});`);
}

function splitDocumentClosing(document: string): { shell: string; closing: string } {
  const bodyIndex = findClosingTag(document, "body");
  const htmlIndex = findClosingTag(document, "html");
  const index = bodyIndex >= 0 ? bodyIndex : htmlIndex;
  return index >= 0
    ? { shell: document.slice(0, index), closing: document.slice(index) }
    : { shell: document, closing: "" };
}

function renderPipelineStreaming(
  match: RouteMatch,
  request: Request,
  layouts: LayoutNode[],
  streamIndex: number,
  mode: RenderMode,
  options: RenderOptions,
  sharedStatic: Metadata[],
  withMemoization: LoaderMemoizationScope,
): RenderedRoute {
  const nodes: RenderNode[] = [...layouts, match.route.page];
  const streamNode = nodes[streamIndex]!;
  const ancestorLayouts = layouts.slice(0, Math.min(streamIndex, layouts.length));
  const deeperLayouts = layouts.slice(Math.min(streamIndex, layouts.length));
  const anchorId = streamId(streamNode.id);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let ancestorMetadata: Metadata = {};
      let documentClosing = "";
      try {
        const loadedAncestors = await withMemoization(() => loadNodes(match, request, ancestorLayouts));
        ancestorMetadata = loadedAncestors.metadata;
        const skeletonInner = `<div id="${escapeAttribute(anchorId)}" data-brandy-stream>${String(streamNode.renderLoading!())}</div>`;
        let skeleton = await wrap(skeletonInner, ancestorLayouts, loadedAncestors, request);
        if (mode === "document") {
          skeleton = injectMetadata(skeleton, mergeMetadata([...sharedStatic, ancestorMetadata]));
          const framed = splitDocumentClosing(skeleton);
          skeleton = framed.shell;
          documentClosing = framed.closing;
        }
        controller.enqueue(encoder.encode(skeleton));
      } catch {
        // Ancestor layouts failed before anything could stream — nothing useful to flush;
        // the trailing chunk below still attempts to report something into the anchor-less void.
      }
      controller.enqueue(encoder.encode(STREAM_BOUNDARY));

      let html: string;
      let metadata = mergeMetadata([...sharedStatic, ancestorMetadata]);
      try {
        const deeper = await withMemoization(() => renderPipelineCore(match, request, deeperLayouts, options));
        html = deeper.html;
        metadata = completedMetadata(match, deeper, [...sharedStatic, ancestorMetadata]);
      } catch {
        html = "<p>Something went wrong.</p>";
        metadata = ERROR_METADATA;
      }
      const tail = mode === "document"
        ? inlineSwap(anchorId, html) + inlineMetaSwap(metadata) + documentClosing
        : streamSwap(anchorId, html) + metadataSwap(metadata, options.metadataMode);
      controller.enqueue(encoder.encode(tail));
      controller.close();
    },
  });

  return { kind: "stream", stream, status: 200 };
}

async function renderPipeline(
  match: RouteMatch,
  request: Request,
  layouts: LayoutNode[],
  mode: RenderMode,
  options: RenderOptions = {},
  sharedStatic: Metadata[] = [],
  withMemoization: LoaderMemoizationScope = createLoaderMemoizationScope(),
): Promise<RenderedRoute> {
  const nodes: RenderNode[] = [...layouts, match.route.page];
  // The root layout (always index 0 for a full document) can never be the streaming boundary —
  // streaming it would mean no <html> shell is available to flush as the first chunk.
  const minIndex = mode === "document" ? 1 : 0;
  const streamIndex = findStreamingIndex(nodes, minIndex);
  if (streamIndex >= 0) {
    if (options.head) return { kind: "stream", stream: new ReadableStream({ start(controller) { controller.close(); } }), status: 200 };
    return renderPipelineStreaming(match, request, layouts, streamIndex, mode, options, sharedStatic, withMemoization);
  }
  const core = await withMemoization(() => renderPipelineCore(match, request, layouts, options));
  return { kind: "sync", html: core.html, status: core.status, metadata: completedMetadata(match, core, sharedStatic) };
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
  return insertBeforeClosingTag(document, "head", tags) ?? `${tags}${document}`;
}

export function metadataSwap(metadata: Metadata, mode: "replace" | "merge" = "replace"): string {
  const attribute = mode === "merge" ? ' data-brandy-head="merge"' : " data-brandy-head";
  return `<template${attribute}>${metaTags(metadata)}</template>`;
}

export async function renderFullMatch(match: RouteMatch, request: Request, options: RenderOptions = {}): Promise<RenderedRoute> {
  return renderPipeline(match, request, match.route.layouts, "document", options);
}

export async function renderFragmentMatch(diff: RouteDiff, request: Request, options: RenderOptions = {}): Promise<RenderedRoute> {
  const sharedCount = diff.target.route.layouts.length - diff.chainToRender.length;
  const sharedStatic = diff.target.route.layouts.slice(0, sharedCount)
    .flatMap((layout) => layout.metadata && typeof layout.metadata !== "function" ? [layout.metadata] : []);
  return renderPipeline(diff.target, request, diff.chainToRender, "fragment", options, sharedStatic);
}

async function drainStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
}

// Backward-compatible low-level helpers retained for P0 consumers.
export async function renderFull(route: Route): Promise<string> {
  const match: RouteMatch = { route, pathname: route.pattern, params: {} };
  const rendered = await renderFullMatch(match, new Request(`http://brandy.local${route.pattern}`));
  return rendered.kind === "sync" ? rendered.html : drainStream(rendered.stream);
}

export async function renderFragment(diff: RouteDiff): Promise<string> {
  const rendered = await renderFragmentMatch(diff, new Request(`http://brandy.local${diff.target.pathname}`));
  return rendered.kind === "sync" ? rendered.html : drainStream(rendered.stream);
}

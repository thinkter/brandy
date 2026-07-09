import { NotFoundError, RedirectError } from "./control.ts";
import { findClosingTag, insertBeforeClosingTag } from "./html.ts";
import { createLoaderMemoizationScope, type LoaderMemoizationScope } from "./memo.ts";
import { escapeAttribute, slotId, streamId } from "./path.ts";
import type {
  LayoutNode, LoadedRoute, Metadata, MetadataExport, PageNode, RenderContext,
  RedirectRenderedRoute, RenderedRoute, RenderOptions, RequestContext, Route, RouteDiff, RouteMatch, SyncRenderedRoute,
} from "./types.ts";

type RenderNode = LayoutNode | PageNode;
type RenderMode = "fragment" | "document";

const STREAM_BOUNDARY = "<!--brandy:stream-boundary-->";

function outlet(layout: LayoutNode, children: string): JSX.Element {
  return `<div id="${slotId(layout.id)}" data-brandy-slot>${children}</div>` as JSX.Element;
}

function context(match: RouteMatch, request: Request): RequestContext {
  return { params: match.params, request, url: new URL(request.url), isPrefetch: request.headers.get("x-brandy-prefetch") === "1" };
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
    if (error instanceof RedirectError) throw error;
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

/** A declarative client-side redirect for loader redirects that arrive after the response has
 * committed (a deferred loader redirecting mid-stream): `<template data-brandy-stream-redirect>`,
 * applied by the client runtime via `location.replace`. Like `streamSwap`, it is plain markup —
 * no inline `<script>` — so streamed responses carry no CSP-hostile executable content and the
 * apply logic lives in the always-shipped external runtime. */
export function streamRedirect(location: string): string {
  return `<template data-brandy-stream-redirect="${escapeAttribute(location)}"></template>`;
}

function splitDocumentClosing(document: string): { shell: string; closing: string } {
  const bodyIndex = findClosingTag(document, "body");
  const htmlIndex = findClosingTag(document, "html");
  const index = bodyIndex >= 0 ? bodyIndex : htmlIndex;
  return index >= 0
    ? { shell: document.slice(0, index), closing: document.slice(index) }
    : { shell: document, closing: "" };
}

/** Machine-readable marker emitted as the sole first chunk when the ancestor phase fails before
 *  anything could be flushed.  Clients and tests can detect this to distinguish a broken skeleton
 *  from a normal (possibly empty) first chunk. */
export const STREAM_ERROR_MARKER = "<!--brandy:stream-error-->";

function logStreamError(label: string, error: unknown, dev: boolean): void {
  if (dev) {
    console.error(`[brandy] streaming render error (${label}):`, error);
  } else {
    // Structured log for production log aggregators.
    console.error(JSON.stringify({
      level: "error",
      source: "brandy",
      phase: label,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }));
  }
}

async function renderPipelineStreaming(
  match: RouteMatch,
  request: Request,
  layouts: LayoutNode[],
  streamIndex: number,
  mode: RenderMode,
  options: RenderOptions,
  sharedStatic: Metadata[],
  withMemoization: LoaderMemoizationScope,
): Promise<RenderedRoute> {
  const nodes: RenderNode[] = [...layouts, match.route.page];
  const streamNode = nodes[streamIndex]!;
  const ancestorLayouts = layouts.slice(0, Math.min(streamIndex, layouts.length));
  const deeperLayouts = layouts.slice(Math.min(streamIndex, layouts.length));
  const anchorId = streamId(streamNode.id);
  const encoder = new TextEncoder();
  const dev = options.dev === true;
  const errorFallback = options.errorFallback ?? "<p>Something went wrong.</p>";

  // ── Ancestor phase (runs eagerly so we know the HTTP status before any bytes commit) ──
  let skeletonChunk: string;
  let documentClosing = "";
  let ancestorMetadata: Metadata = {};
  let ancestorFailed = false;
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
    skeletonChunk = skeleton;
  } catch (error) {
    // The ancestor phase runs before any bytes commit, so a loader redirect here can still
    // become a real HTTP redirect — propagate it to renderPipeline instead of emitting a script.
    if (error instanceof RedirectError) throw error;
    // Ancestor layouts failed before any bytes were committed — headers have not been sent yet,
    // so we can report a real 500 status.  Emit the machine-readable error marker as the sole
    // first chunk so clients/tests can detect the failure mode.
    logStreamError("ancestor", error, dev);
    ancestorFailed = true;
    skeletonChunk = STREAM_ERROR_MARKER;
  }

  const status: 200 | 500 = ancestorFailed ? 500 : 200;

  // ── Deferred phase (runs inside the stream so the skeleton flushes first) ──
  const capturedAncestorMetadata = ancestorMetadata;
  const capturedDocumentClosing = documentClosing;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(skeletonChunk));
      controller.enqueue(encoder.encode(STREAM_BOUNDARY));

      if (ancestorFailed) {
        // No anchor exists in the DOM — skip the swap script entirely.
        controller.close();
        return;
      }

      let html: string;
      let metadata = mergeMetadata([...sharedStatic, capturedAncestorMetadata]);
      try {
        const deeper = await withMemoization(() => renderPipelineCore(match, request, deeperLayouts, options));
        html = deeper.html;
        metadata = mergeMetadata([...sharedStatic, capturedAncestorMetadata, deeper.metadata]);
      } catch (error) {
        if (error instanceof RedirectError) {
          // A deferred loader redirected after the skeleton shipped — headers are already
          // committed, so emit a declarative redirect template (applied by the client runtime
          // via location.replace) instead of an HTTP redirect.
          const location = error.response.headers.get("location") ?? "/";
          const tail = mode === "document"
            ? streamRedirect(location) + capturedDocumentClosing
            : streamRedirect(location);
          controller.enqueue(encoder.encode(tail));
          controller.close();
          return;
        }
        // Deeper render failed after the skeleton was already shipped — HTTP headers already committed.
        // Log the error and emit the configurable fallback so the slot is never left empty.
        logStreamError("deferred", error, dev);
        html = errorFallback;
      }
      // Both modes deliver deferred content as the same declarative templates: the always-shipped
      // client runtime applies them (on cold loads via its boot sweep, since a module script only
      // executes once the document — and therefore the stream — has finished). No inline <script>
      // is emitted, so streamed documents work under a strict CSP without nonces. Without JS the
      // templates are inert and the skeleton remains — the documented streaming trade-off.
      const tail = mode === "document"
        ? streamSwap(anchorId, html) + metadataSwap(metadata) + capturedDocumentClosing
        : streamSwap(anchorId, html) + metadataSwap(metadata, options.metadataMode);
      controller.enqueue(encoder.encode(tail));
      controller.close();
    },
  });

  return { kind: "stream", stream, status };
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
  try {
    if (streamIndex >= 0) return await renderPipelineStreaming(match, request, layouts, streamIndex, mode, options, sharedStatic, withMemoization);
    const core = await withMemoization(() => renderPipelineCore(match, request, layouts, options));
    return { kind: "sync", html: core.html, status: core.status, metadata: mergeMetadata([...sharedStatic, core.metadata]) };
  } catch (error) {
    if (error instanceof RedirectError) return { kind: "redirect", response: error.response };
    throw error;
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
  if (rendered.kind === "sync") return rendered.html;
  if (rendered.kind === "stream") return drainStream(rendered.stream);
  return "";
}

export async function renderFragment(diff: RouteDiff): Promise<string> {
  const rendered = await renderFragmentMatch(diff, new Request(`http://brandy.local${diff.target.pathname}`));
  if (rendered.kind === "sync") return rendered.html;
  if (rendered.kind === "stream") return drainStream(rendered.stream);
  return "";
}

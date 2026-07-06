import type {} from "./alpine-jsx.d.ts";
import { applyRenderSnapshot, createMemoryRenderCache, renderFragmentMatchCached, renderFragmentMatchFresh, renderFullMatchCached } from "./core/cache.ts";
import type { RenderCache, RenderCacheEntry } from "./core/cache.ts";
import { isRevalidation } from "./core/control.ts";
import { matchRoute, RouteNotFoundError } from "./core/diff.ts";
import { hasElementAttribute, insertBeforeClosingTag } from "./core/html.ts";
import { escapeAttribute, normalizePathname, slotId } from "./core/path.ts";
import { injectMetadata, metadataSwap, renderFragmentMatch, streamSwap } from "./core/render.ts";
import type { PageNode, Route, RouteDiff, RouteManifest, RouteMatch } from "./core/types.ts";

export const PARTIAL_HEADER = "x-brandy-navigation";
export const CURRENT_URL_HEADER = "x-brandy-current-url";
export const RETARGET_HEADER = "x-brandy-retarget";
export const RESWAP_HEADER = "x-brandy-reswap";
export const TARGET_URL_HEADER = "x-brandy-url";
export const REFRESH_BOUNDARY_HEADER = "x-brandy-refresh-boundary";
export const PREFETCH_HEADER = "x-brandy-prefetch";
export const STREAM_HEADER = "x-brandy-stream";
export const NO_INTERCEPT_HEADER = "x-brandy-no-intercept";
/** Reserved element id for intercepting-route modals. Brandy injects this div into the document
 * automatically — apps never declare it, matching "the developer never hand-writes a target". */
export const MODAL_OUTLET_ID = "brandy-modal-outlet";

export interface BrandyOptions {
  manifest: RouteManifest;
  clientPath?: string;
  stylesheet?: string;
  stylesheetPath?: string;
  dev?: boolean;
  setup?: (app: BrandyApplication) => void | Promise<void>;
  runtime?: string;
  alpineChunk?: string;
  alpineChunkPath?: string;
  trustedOrigins?: string[];
  serveAsset?: (request: Request) => Response | undefined | Promise<Response | undefined>;
  immutablePrerender?: boolean;
  /** Build-time-warmed prerender cache entries, loaded at boot. See build.ts. */
  prerenderSnapshot?: Record<string, RenderCacheEntry>;
}

export interface BrandyRequestContext {
  request: Request;
}

export type BrandyRequestHandler = (context: BrandyRequestContext) => unknown | Promise<unknown>;

interface RegisteredRoute {
  method: string;
  path: string;
  handler: BrandyRequestHandler;
}

function canonicalPathname(pathname: string): string {
  return pathname === "/" ? pathname : pathname.replace(/\/+$/, "") || "/";
}

function routeMatches(pattern: string, pathname: string): boolean {
  return pattern.endsWith("*") ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern;
}

async function responseFrom(value: unknown): Promise<Response> {
  const resolved = await value;
  if (resolved instanceof Response) return resolved;
  if (resolved !== null && typeof resolved === "object") return Response.json(resolved);
  return new Response(resolved === undefined ? null : String(resolved));
}

export class BrandyApplication {
  private readonly routes: RegisteredRoute[] = [];
  private fallback: (request: Request) => Promise<Response> = async () => new Response("Not found", { status: 404 });

  get(path: string, handler: BrandyRequestHandler): this {
    this.routes.push({ method: "GET", path: canonicalPathname(path), handler });
    return this;
  }

  post(path: string, handler: BrandyRequestHandler): this {
    this.routes.push({ method: "POST", path: canonicalPathname(path), handler });
    return this;
  }

  setFallback(handler: (request: Request) => Promise<Response>): void {
    this.fallback = handler;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = canonicalPathname(url.pathname);
      return Response.redirect(url, 308);
    }
    const pathname = url.pathname;
    const route = this.routes.find((candidate) => candidate.method === request.method && routeMatches(candidate.path, pathname));
    return route ? responseFrom(route.handler({ request })) : this.fallback(request);
  }

  readonly fetch = (request: Request): Promise<Response> => this.handle(request);
}

function normalizeTrustedOrigins(values: string[]): Set<string> {
  return new Set(values.map((value) => {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error(`Invalid trusted origin: ${JSON.stringify(value)}`); }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error(`Invalid trusted origin: ${JSON.stringify(value)}. Expected an HTTP(S) origin without a path, query, or fragment.`);
    }
    return url.origin;
  }));
}

function actionSourceOrigin(request: Request): string | undefined {
  const value = request.headers.get("origin") ?? request.headers.get("referer");
  if (!value || value === "null") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch { return undefined; }
}

function cacheNotFoundRoute(manifest: RouteManifest): Route {
  if (manifest.notFoundRoute) return manifest.notFoundRoute;
  const explicit = manifest.routes.find((route) => route.pattern === "/404");
  if (explicit) return manifest.notFoundRoute = explicit;
  const root = manifest.routes[0]!.layouts[0]!;
  const renderNotFound = manifest.rootNotFound ?? (() => "<main><h1>Not found</h1></main>");
  const page: PageNode = {
    id: "not-found/page", directory: manifest.appDir, file: "not-found.tsx",
    render: renderNotFound, renderNotFound,
  };
  const route: Route = {
    id: "/404", pattern: "/404", segments: ["404"],
    layouts: [root], page, pageFile: page.file, renderPage: page.render,
  };
  manifest.notFoundRoute = route;
  return route;
}

function resolveMatch(manifest: RouteManifest, pathname: string): { match: RouteMatch; missing: boolean } {
  try { return { match: matchRoute(manifest, pathname), missing: false }; }
  catch (error) {
    if (!(error instanceof RouteNotFoundError)) throw error;
    return { match: { route: manifest.notFoundRoute!, pathname, params: {}, missing: true }, missing: true };
  }
}

function sameSegments(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((segment, index) => segment === b[index]);
}

function diffMatches(current: RouteMatch, target: RouteMatch) {
  let shared = 0;
  while (shared < current.route.layouts.length && shared < target.route.layouts.length && current.route.layouts[shared]!.id === target.route.layouts[shared]!.id) shared++;
  const boundary = target.route.layouts[Math.max(0, shared - 1)];
  if (!boundary) throw new Error("Routes do not share a root layout");
  return { current, target, boundary, chainToRender: target.route.layouts.slice(shared) };
}

function isFingerprintedAsset(path: string): boolean {
  return /^\/_brandy\/(?:runtime|app|alpine)\.[a-f0-9]{8,64}\.(?:js|css)$/.test(path);
}

function assetCacheControl(path: string, dev: boolean): string {
  return !dev && isFingerprintedAsset(path) ? "public, max-age=31536000, immutable" : "no-cache";
}

export function injectClientRuntime(document: string, clientPath: string): string {
  if (hasElementAttribute(document, "script", "src", clientPath)) return document;
  const script = `<script type="module" src="${escapeAttribute(clientPath)}"></script>`;
  return insertBeforeClosingTag(document, "body", script) ?? `${document}${script}`;
}

function injectStylesheet(document: string, stylesheet: string): string {
  if (hasElementAttribute(document, "link", "href", stylesheet)) return document;
  const link = `<link rel="stylesheet" href="${escapeAttribute(stylesheet)}">`;
  return insertBeforeClosingTag(document, "head", link) ?? `${link}${document}`;
}

function injectAlpineCloakStyle(document: string): string {
  if (hasElementAttribute(document, "style", "data-brandy-cloak", "")) return document;
  const style = `<style data-brandy-cloak>[x-cloak]{display:none!important}</style>`;
  return insertBeforeClosingTag(document, "head", style) ?? `${style}${document}`;
}

function injectAlpineModulePreload(document: string, alpineChunkPath: string): string {
  if (!hasElementAttribute(document, undefined, "data-brandy-island", "")) return document;
  if (hasElementAttribute(document, "link", "href", alpineChunkPath)) return document;
  const link = `<link rel="modulepreload" href="${escapeAttribute(alpineChunkPath)}">`;
  return insertBeforeClosingTag(document, "head", link) ?? `${link}${document}`;
}

/** A streamed page can reveal its first Island only after the document head has flushed.
 * In that case, emit the preload immediately before the deferred swap chunk so the browser
 * starts fetching Alpine before the swap script initializes the newly inserted Island. */
function injectDeferredAlpineModulePreload(stream: ReadableStream<Uint8Array>, alpineChunkPath: string): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const link = `<link rel="modulepreload" href="${escapeAttribute(alpineChunkPath)}">`;
  let preloadInjected = false;
  let suffix = "";
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      let html = decoder.decode(chunk, { stream: true });
      if (hasElementAttribute(html, "link", "href", alpineChunkPath)) preloadInjected = true;
      if (!preloadInjected && `${suffix}${html}`.includes("data-brandy-island")) {
        html = `${link}${html}`;
        preloadInjected = true;
      }
      suffix = `${suffix}${html}`.slice(-"data-brandy-island".length);
      controller.enqueue(encoder.encode(html));
    },
    flush(controller) {
      const rest = decoder.decode();
      if (rest) controller.enqueue(encoder.encode(rest));
    },
  }));
}

function injectDevRuntime(document: string): string {
  if (hasElementAttribute(document, "script", "src", "/_brandy/dev.js")) return document;
  const script = `<script type="module" src="/_brandy/dev.js"></script>`;
  return insertBeforeClosingTag(document, "body", script) ?? `${document}${script}`;
}

function injectModalOutlet(document: string): string {
  if (hasElementAttribute(document, undefined, "id", MODAL_OUTLET_ID)) return document;
  const div = `<div id="${MODAL_OUTLET_ID}" data-brandy-slot></div>`;
  return insertBeforeClosingTag(document, "body", div) ?? `${document}${div}`;
}

/** Appends one more chunk after a stream finishes — used to attach the modal-outlet-clear
 * OOB instruction to an ordinary streaming navigation without buffering the whole body. */
function appendToStream(stream: ReadableStream<Uint8Array>, trailer: string): ReadableStream<Uint8Array> {
  if (!trailer) return stream;
  const encoder = new TextEncoder();
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    flush(controller) { controller.enqueue(encoder.encode(trailer)); },
  }));
}

/** Applies a string transform to only the first chunk of a stream — used to inject static
 * (loader-independent) assets into a streaming document's skeleton without buffering the whole body. */
function injectIntoFirstChunk(stream: ReadableStream<Uint8Array>, transform: (html: string) => string): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let injected = false;
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (!injected) {
        injected = true;
        controller.enqueue(encoder.encode(transform(decoder.decode(chunk, { stream: true }))));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}

export async function createBrandy(options: BrandyOptions): Promise<BrandyApplication> {
  const manifest = options.manifest;
  cacheNotFoundRoute(manifest);
  const mutableCache = createMemoryRenderCache();
  const renderCache: RenderCache = options.immutablePrerender
    ? { get: mutableCache.get, set() {}, delete() {} }
    : mutableCache;
  if (options.prerenderSnapshot) applyRenderSnapshot(options.prerenderSnapshot, mutableCache);
  const clientPath = options.clientPath ?? "/_brandy/runtime.js";
  const stylesheetPath = options.stylesheetPath;
  const alpineChunkPath = options.alpineChunkPath;
  const trustedOrigins = normalizeTrustedOrigins(options.trustedOrigins ?? []);
  const renderOptions = { dev: options.dev === true };
  const hasInterceptedRoutes = manifest.routes.some((route) => (route.interceptedBy?.length ?? 0) > 0);
  const modalClear = hasInterceptedRoutes ? streamSwap(MODAL_OUTLET_ID, "") : "";
  const app = new BrandyApplication();

  if (options.setup) await options.setup(app);

  if (options.runtime) app.get(clientPath, () => new Response(options.runtime, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": assetCacheControl(clientPath, options.dev === true) },
  }));

  if (options.stylesheet && stylesheetPath) app.get(stylesheetPath, () => new Response(options.stylesheet, {
    headers: { "content-type": "text/css; charset=utf-8", "cache-control": assetCacheControl(stylesheetPath, options.dev === true) },
  }));

  if (options.alpineChunk && alpineChunkPath) app.get(alpineChunkPath, () => new Response(options.alpineChunk, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": assetCacheControl(alpineChunkPath, options.dev === true) },
  }));

  app.post("/_brandy/actions/*", async ({ request }) => {
    const sourceOrigin = actionSourceOrigin(request);
    const requestOrigin = new URL(request.url).origin;
    if (!sourceOrigin || sourceOrigin !== requestOrigin && !trustedOrigins.has(sourceOrigin)) {
      return new Response("Forbidden", { status: 403 });
    }
    const actionPath = new URL(request.url).pathname;
    const action = manifest.actions.get(actionPath);
    if (!action) return new Response("Unknown action", { status: 404 });
    const currentPath = normalizePathname(request.headers.get(CURRENT_URL_HEADER) ?? request.headers.get("referer") ?? "/");
    const current = resolveMatch(manifest, currentPath).match;
    const result = await action.handler(await request.formData(), { params: current.params, request, url: new URL(currentPath, request.url) });
    if (result instanceof Response) return result;
    const targetPath = normalizePathname(isRevalidation(result) ? result.path : currentPath);
    const target = resolveMatch(manifest, targetPath).match;
    if (options.immutablePrerender && isRevalidation(result) && target.route.page.cache) {
      return new Response("Cannot revalidate an immutable prerendered route on this deployment adapter", { status: 409 });
    }
    const targetRequest = new Request(new URL(targetPath, request.url), { headers: request.headers });
    const headers = new Headers({ [TARGET_URL_HEADER]: targetPath, "content-type": "text/html; charset=utf-8" });

    if (request.headers.get(PARTIAL_HEADER) === "1") {
      const diff = diffMatches(current, target);
      const rendered = await renderFragmentMatchFresh(diff, targetRequest, renderOptions, renderCache);
      headers.set(RETARGET_HEADER, `#${slotId(diff.boundary.id)}`);
      headers.set(RESWAP_HEADER, "innerHTML");
      if (rendered.kind === "stream") {
        headers.set(STREAM_HEADER, "1");
        return new Response(appendToStream(rendered.stream, modalClear), { status: 200, headers });
      }
      return new Response(`${rendered.html}${metadataSwap(rendered.metadata)}${modalClear}`, { status: rendered.status, headers });
    }
    return Response.redirect(new URL(targetPath, request.url), 303);
  });

  app.setFallback(async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const asset = await options.serveAsset?.(request);
    if (asset) return asset;
    const targetPath = normalizePathname(request.url);
    const targetResult = resolveMatch(manifest, targetPath);
    const headers = new Headers({ "content-type": "text/html; charset=utf-8" });
    const requestRenderOptions = request.method === "HEAD" ? { ...renderOptions, head: true } : renderOptions;
    if (request.headers.get(PARTIAL_HEADER) === "1") {
      const currentPath = request.headers.get(CURRENT_URL_HEADER);
      if (!currentPath) return new Response("Missing x-brandy-current-url header", { status: 400, headers });
      const current = resolveMatch(manifest, normalizePathname(currentPath)).match;

      const noIntercept = request.headers.get(NO_INTERCEPT_HEADER) === "1";
      const interception = hasInterceptedRoutes && !noIntercept && !targetResult.missing && current.pathname !== targetPath
        ? targetResult.match.route.interceptedBy?.find((entry) => sameSegments(entry.fromSegments, current.route.segments))
        : undefined;

      if (interception) {
        const syntheticRoute: Route = {
          id: targetResult.match.route.id, pattern: targetResult.match.route.pattern, segments: targetResult.match.route.segments,
          layouts: [], page: interception.page, pageFile: interception.page.file, renderPage: interception.page.render,
        };
        const syntheticTarget: RouteMatch = { route: syntheticRoute, pathname: targetResult.match.pathname, params: targetResult.match.params };
        const diff: RouteDiff = { current, target: syntheticTarget, boundary: current.route.layouts[0]!, chainToRender: [] };
        const rendered = await renderFragmentMatch(diff, request, { ...requestRenderOptions, metadataMode: "merge" });
        headers.set(RETARGET_HEADER, `#${MODAL_OUTLET_ID}`);
        headers.set(RESWAP_HEADER, "innerHTML");
        headers.set(TARGET_URL_HEADER, targetPath);
        headers.set("vary", `${PARTIAL_HEADER}, ${CURRENT_URL_HEADER}`);
        if (rendered.kind === "stream") {
          headers.set(STREAM_HEADER, "1");
          return new Response(request.method === "HEAD" ? null : rendered.stream, { status: 200, headers });
        }
        return new Response(`${rendered.html}${metadataSwap(rendered.metadata, "merge")}`, { status: rendered.status, headers });
      }

      const refresh = request.headers.get(REFRESH_BOUNDARY_HEADER);
      let diff = diffMatches(current, targetResult.match);
      if (refresh) {
        const index = targetResult.match.route.layouts.findIndex((layout) => layout.id === refresh);
        if (index >= 0) {
          const boundary = targetResult.match.route.layouts[Math.max(0, index - 1)]!;
          diff = { current, target: targetResult.match, boundary, chainToRender: targetResult.match.route.layouts.slice(index) };
        }
      }
      const rendered = await renderFragmentMatchCached(diff, request, requestRenderOptions, renderCache);
      headers.set(RETARGET_HEADER, `#${slotId(diff.boundary.id)}`);
      headers.set(RESWAP_HEADER, "innerHTML");
      headers.set(TARGET_URL_HEADER, targetPath);
      headers.set("vary", `${PARTIAL_HEADER}, ${CURRENT_URL_HEADER}`);
      if (rendered.kind === "stream") {
        headers.set(STREAM_HEADER, "1");
        return new Response(request.method === "HEAD" ? null : appendToStream(rendered.stream, modalClear), { status: targetResult.missing ? 404 : 200, headers });
      }
      return new Response(`${rendered.html}${metadataSwap(rendered.metadata)}${modalClear}`, { status: targetResult.missing ? 404 : rendered.status, headers });
    }
    const rendered = await renderFullMatchCached(targetResult.match, request, requestRenderOptions, renderCache);
    if (rendered.kind === "stream") {
      headers.set(STREAM_HEADER, "1");
      if (request.method === "HEAD") return new Response(null, { status: targetResult.missing ? 404 : 200, headers });
      let stream = injectIntoFirstChunk(rendered.stream, (html) => {
        let document = injectClientRuntime(html, clientPath);
        if (stylesheetPath) document = injectStylesheet(document, stylesheetPath);
        if (alpineChunkPath) {
          document = injectAlpineCloakStyle(document);
          document = injectAlpineModulePreload(document, alpineChunkPath);
        }
        if (options.dev) document = injectDevRuntime(document);
        if (hasInterceptedRoutes) document = injectModalOutlet(document);
        return document;
      });
      if (alpineChunkPath) stream = injectDeferredAlpineModulePreload(stream, alpineChunkPath);
      return new Response(stream, { status: targetResult.missing ? 404 : 200, headers });
    }
    let document = injectClientRuntime(injectMetadata(rendered.html, rendered.metadata), clientPath);
    if (stylesheetPath) document = injectStylesheet(document, stylesheetPath);
    if (alpineChunkPath) {
      document = injectAlpineCloakStyle(document);
      document = injectAlpineModulePreload(document, alpineChunkPath);
    }
    if (options.dev) document = injectDevRuntime(document);
    if (hasInterceptedRoutes) document = injectModalOutlet(document);
    return new Response(request.method === "HEAD" ? null : document, { status: targetResult.missing ? 404 : rendered.status, headers });
  });
  return app;
}

export * from "./core/cache.ts";
export * from "./core/control.ts";
export * from "./core/diff.ts";
export * from "./core/island.tsx";
export { memoizeLoader } from "./core/memo.ts";
export * from "./core/path.ts";
export * from "./core/render.ts";
export * from "./core/types.ts";

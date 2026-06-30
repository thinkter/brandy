import type {} from "./alpine-jsx.d.ts";
import { Elysia } from "elysia";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isRevalidation } from "./core/control.ts";
import { matchRoute } from "./core/diff.ts";
import { escapeAttribute, normalizePathname, slotId } from "./core/path.ts";
import { injectMetadata, metadataSwap, renderFragmentMatch, renderFullMatch } from "./core/render.ts";
import type { PageNode, Route, RouteManifest, RouteMatch } from "./core/types.ts";
import { buildManifest } from "./core/walker.ts";
import type { BrandyConfig } from "./config.ts";

export const PARTIAL_HEADER = "x-brandy-navigation";
export const CURRENT_URL_HEADER = "x-brandy-current-url";
export const RETARGET_HEADER = "x-brandy-retarget";
export const RESWAP_HEADER = "x-brandy-reswap";
export const TARGET_URL_HEADER = "x-brandy-url";
export const REFRESH_BOUNDARY_HEADER = "x-brandy-refresh-boundary";
export const PREFETCH_HEADER = "x-brandy-prefetch";
export const STREAM_HEADER = "x-brandy-stream";

export interface BrandyOptions {
  appDir?: string;
  manifest?: RouteManifest;
  clientPath?: string;
  alpine?: boolean;
  stylesheet?: string;
  publicDir?: string | false;
  dev?: boolean;
  setup?: BrandyConfig["setup"];
  runtime?: string;
  cacheBust?: string;
  trustedOrigins?: string[];
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
    if (!(error instanceof Error) || !error.message.startsWith("No route matches")) throw error;
    return { match: { route: manifest.notFoundRoute!, pathname, params: {} }, missing: true };
  }
}

function diffMatches(current: RouteMatch, target: RouteMatch) {
  let shared = 0;
  while (shared < current.route.layouts.length && shared < target.route.layouts.length && current.route.layouts[shared]!.id === target.route.layouts[shared]!.id) shared++;
  const boundary = target.route.layouts[Math.max(0, shared - 1)];
  if (!boundary) throw new Error("Routes do not share a root layout");
  return { current, target, boundary, chainToRender: target.route.layouts.slice(shared) };
}

const runtimeBuilds = new Map<boolean, Promise<string>>();

async function buildRuntime(alpine: boolean): Promise<string> {
  const entrypoint = alpine ? "./client/runtime-alpine.ts" : "./client/runtime.ts";
  const build = await Bun.build({ entrypoints: [new URL(entrypoint, import.meta.url).pathname], target: "browser", minify: true });
  if (!build.success || !build.outputs[0]) throw new AggregateError(build.logs, "Failed to build the Brandy client runtime");
  return build.outputs[0].text();
}

export const buildClientRuntime = buildRuntime;

function compiledRuntime(alpine: boolean): Promise<string> {
  const existing = runtimeBuilds.get(alpine);
  if (existing) return existing;
  const build = buildRuntime(alpine);
  runtimeBuilds.set(alpine, build);
  return build;
}

export function injectClientRuntime(document: string, clientPath: string): string {
  if (document.includes(`src="${clientPath}"`) || document.includes(`src='${clientPath}'`)) return document;
  const script = `<script type="module" src="${escapeAttribute(clientPath)}"></script>`;
  return document.includes("</body>") ? document.replace("</body>", `${script}</body>`) : `${document}${script}`;
}

function injectStylesheet(document: string, stylesheet: string): string {
  if (document.includes(`href="${stylesheet}"`) || document.includes(`href='${stylesheet}'`)) return document;
  const link = `<link rel="stylesheet" href="${escapeAttribute(stylesheet)}">`;
  return document.includes("</head>") ? document.replace("</head>", `${link}</head>`) : `${link}${document}`;
}

function injectDevRuntime(document: string): string {
  if (document.includes("/_brandy/dev.js")) return document;
  const script = `<script type="module" src="/_brandy/dev.js"></script>`;
  return document.includes("</body>") ? document.replace("</body>", `${script}</body>`) : `${document}${script}`;
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

export async function createBrandy(options: BrandyOptions): Promise<Elysia> {
  const manifest = options.manifest ?? await buildManifest(options.appDir ?? "app", options.cacheBust);
  cacheNotFoundRoute(manifest);
  const clientPath = options.clientPath ?? "/_brandy/runtime.js";
  const runtime = options.runtime ?? await compiledRuntime(options.alpine !== false);
  const trustedOrigins = normalizeTrustedOrigins(options.trustedOrigins ?? []);
  const publicDir = options.publicDir ? resolve(options.publicDir) : undefined;
  const renderOptions = { dev: options.dev === true };
  const app = new Elysia();

  if (options.setup) await options.setup(app);

  app.get(clientPath, () => new Response(runtime, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
  }));

  if (options.stylesheet) app.get("/_brandy/app.css", () => new Response(options.stylesheet, {
    headers: { "content-type": "text/css; charset=utf-8", "cache-control": options.dev ? "no-cache" : "public, max-age=31536000, immutable" },
  }));

  app.post("/_brandy/actions/*", async ({ request, set }) => {
    const sourceOrigin = actionSourceOrigin(request);
    const requestOrigin = new URL(request.url).origin;
    if (!sourceOrigin || sourceOrigin !== requestOrigin && !trustedOrigins.has(sourceOrigin)) {
      return new Response("Forbidden", { status: 403 });
    }
    const actionPath = new URL(request.url).pathname;
    const action = manifest.actions.get(actionPath);
    if (!action) { set.status = 404; return "Unknown action"; }
    const currentPath = normalizePathname(request.headers.get(CURRENT_URL_HEADER) ?? request.headers.get("referer") ?? "/");
    const current = resolveMatch(manifest, currentPath).match;
    const result = await action.handler(await request.formData(), { params: current.params, request, url: new URL(currentPath, request.url) });
    if (result instanceof Response) return result;
    const targetPath = normalizePathname(isRevalidation(result) ? result.path : currentPath);
    const target = resolveMatch(manifest, targetPath).match;
    const targetRequest = new Request(new URL(targetPath, request.url), { headers: request.headers });
    set.headers[TARGET_URL_HEADER] = targetPath;
    set.headers["content-type"] = "text/html; charset=utf-8";

    if (request.headers.get(PARTIAL_HEADER) === "1") {
      const diff = diffMatches(current, target);
      const rendered = await renderFragmentMatch(diff, targetRequest, renderOptions);
      set.headers[RETARGET_HEADER] = `#${slotId(diff.boundary.id)}`;
      set.headers[RESWAP_HEADER] = "innerHTML";
      if (rendered.kind === "stream") {
        set.status = 200;
        set.headers[STREAM_HEADER] = "1";
        return rendered.stream;
      }
      set.status = rendered.status;
      return `${rendered.html}${metadataSwap(rendered.metadata)}`;
    }
    return Response.redirect(new URL(targetPath, request.url), 303);
  });

  app.get("/*", async ({ request, set }) => {
    const publicPath = decodeURIComponent(new URL(request.url).pathname);
    if (publicDir && !publicPath.startsWith("/_brandy/")) {
      const filePath = resolve(publicDir, publicPath.slice(1));
      const relativePath = relative(publicDir, filePath);
      const isWithinPublicDir = relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
      if (isWithinPublicDir) {
        const file = Bun.file(filePath);
        if (await file.exists()) return new Response(file);
      }
    }
    const targetPath = normalizePathname(request.url);
    const targetResult = resolveMatch(manifest, targetPath);
    set.headers["content-type"] = "text/html; charset=utf-8";
    if (request.headers.get(PARTIAL_HEADER) === "1") {
      const currentPath = request.headers.get(CURRENT_URL_HEADER);
      if (!currentPath) { set.status = 400; return "Missing x-brandy-current-url header"; }
      const current = resolveMatch(manifest, normalizePathname(currentPath)).match;
      const refresh = request.headers.get(REFRESH_BOUNDARY_HEADER);
      let diff = diffMatches(current, targetResult.match);
      if (refresh) {
        const index = targetResult.match.route.layouts.findIndex((layout) => layout.id === refresh);
        if (index >= 0) {
          const boundary = targetResult.match.route.layouts[Math.max(0, index - 1)]!;
          diff = { current, target: targetResult.match, boundary, chainToRender: targetResult.match.route.layouts.slice(index) };
        }
      }
      const rendered = await renderFragmentMatch(diff, request, renderOptions);
      set.headers[RETARGET_HEADER] = `#${slotId(diff.boundary.id)}`;
      set.headers[RESWAP_HEADER] = "innerHTML";
      set.headers[TARGET_URL_HEADER] = targetPath;
      set.headers["vary"] = `${PARTIAL_HEADER}, ${CURRENT_URL_HEADER}`;
      if (rendered.kind === "stream") {
        set.status = targetResult.missing ? 404 : 200;
        set.headers[STREAM_HEADER] = "1";
        return rendered.stream;
      }
      set.status = targetResult.missing ? 404 : rendered.status;
      return `${rendered.html}${metadataSwap(rendered.metadata)}`;
    }
    const rendered = await renderFullMatch(targetResult.match, request, renderOptions);
    if (rendered.kind === "stream") {
      set.status = targetResult.missing ? 404 : 200;
      set.headers[STREAM_HEADER] = "1";
      return injectIntoFirstChunk(rendered.stream, (html) => {
        let document = injectClientRuntime(html, clientPath);
        if (options.stylesheet) document = injectStylesheet(document, "/_brandy/app.css");
        if (options.dev) document = injectDevRuntime(document);
        return document;
      });
    }
    set.status = targetResult.missing ? 404 : rendered.status;
    let document = injectClientRuntime(injectMetadata(rendered.html, rendered.metadata), clientPath);
    if (options.stylesheet) document = injectStylesheet(document, "/_brandy/app.css");
    if (options.dev) document = injectDevRuntime(document);
    return document;
  });
  return app;
}

export * from "./core/control.ts";
export * from "./core/diff.ts";
export * from "./core/path.ts";
export * from "./core/render.ts";
export * from "./core/types.ts";
export * from "./core/walker.ts";
export * from "./config.ts";

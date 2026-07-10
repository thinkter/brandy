import { access, mkdir, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { AdapterRuntime } from "./adapters.ts";
import { buildManifest } from "./core/walker.ts";
import { keyFor, type RenderCacheEntry } from "./core/cache.ts";
import { guardPersonalizedRequest } from "./core/personalization.ts";
import { renderFragmentMatch } from "./core/render.ts";
import type { LayoutNode, PageNode, RouteManifest } from "./core/types.ts";
import { compileStyles, copyDirectory, latestMtime, resetDirectory, type ResolvedConfig } from "./tooling.ts";
import { buildAlpineChunk, buildClientRuntime, DEFAULT_ALPINE_CHUNK_PATH } from "./browser.ts";
import { createBrandy } from "./server.ts";

/** Eagerly renders every depth (0..N ancestor layouts) for statically-patterned routes (no
 * `[id]` segments) that declared `prerender`/`revalidate`, so the very first production request
 * doesn't pay a cold-cache miss. Routes with dynamic segments populate lazily on first request
 * instead — there's no `generateStaticParams`-equivalent, since `revalidate` is a time-based
 * primitive, not an enumeration-based one.
 *
 * Every route reached here has `route.page.cache` set, so its render (and its ancestor layouts',
 * which are baked into the same cached output) is guarded against reading per-user data: a
 * cookie- or auth-header-reading loader must fail the *build* rather than silently caching an
 * anonymous variant that gets served to every visitor in production. */
async function warmPrerenderCache(manifest: RouteManifest): Promise<Record<string, RenderCacheEntry>> {
  const snapshot: Record<string, RenderCacheEntry> = {};
  for (const route of manifest.routes) {
    const cache = route.page.cache;
    if (!cache || route.segments.some((segment) => segment.startsWith("["))) continue;
    const match = { route, pathname: route.pattern, params: {} };
    const request = guardPersonalizedRequest(new Request(`http://brandy.local${route.pattern}`), route.pattern);
    for (let shared = 0; shared <= route.layouts.length; shared++) {
      const chainToRender = route.layouts.slice(shared);
      // `boundary` is never read by renderFragmentMatch's implementation; any layout satisfies the type.
      const diff = { current: match, target: match, boundary: route.layouts[0]!, chainToRender };
      const rendered = await renderFragmentMatch(diff, request);
      if (rendered.kind !== "sync" || rendered.status !== 200) continue;
      const key = keyFor(route.pattern, chainToRender.length, {}, "");
      snapshot[key] = { html: rendered.html, metadata: rendered.metadata, expiresAt: cache.revalidateSeconds === null ? null : Date.now() + cache.revalidateSeconds * 1000 };
    }
  }
  return snapshot;
}

async function existing(file: string): Promise<boolean> { try { await access(file); return true; } catch { return false; } }
const ERROR_FILES = ["error.tsx", "error.ts", "error.jsx", "error.js"];
const NOT_FOUND_FILES = ["not-found.tsx", "not-found.ts", "not-found.jsx", "not-found.js"];
const LOADING_FILES = ["loading.tsx", "loading.ts", "loading.jsx", "loading.js"];

function contentHash(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

function isFingerprintedPublicAsset(path: string): boolean {
  return /(?:^|[._-])[a-f0-9]{8,64}(?=\.[^/]+$)/i.test(path);
}

// Fingerprinted assets (runtime/app/alpine bundles, hashed public files) are content-addressed:
// their URL changes whenever the content does, so it's safe to cache them forever.
const IMMUTABLE_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
// Prerendered page HTML is served at a stable, user-facing URL. Redeploys must reach returning
// visitors, so browsers/CDNs must revalidate instead of trusting a long max-age blindly.
const REVALIDATE_PAGE_CACHE_CONTROL = "public, max-age=0, must-revalidate";

async function nearest(directory: string, appDir: string, names: string[]): Promise<string | undefined> {
  let current = directory;
  while (current.startsWith(appDir)) {
    for (const name of names) { const file = join(current, name); if (await existing(file)) return file; }
    if (current === appDir) break;
    current = dirname(current);
  }
}

// loading.tsx is not inherited like error/not-found — only the node's own directory counts.
async function ownFile(directory: string, names: string[]): Promise<string | undefined> {
  for (const name of names) { const file = join(directory, name); if (await existing(file)) return file; }
}

async function publicPaths(directory: string | false): Promise<string[]> {
  if (!directory || !await existing(directory)) return [];
  const result: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else result.push(`/${relative(directory as string, path).split(sep).join("/")}`);
    }
  }
  await walk(directory); return result;
}

interface CompiledAssets {
  runtime: string;
  runtimePath: string;
  stylesheet?: string;
  stylesheetPath?: string;
  alpineChunk?: string;
  alpineChunkPath?: string;
}

async function writeStaticAssets(directory: string, config: ResolvedConfig, assets: CompiledAssets, documents: Record<string, string>): Promise<void> {
  await mkdir(directory, { recursive: true });
  await copyDirectory(config.publicDir, directory);
  await Bun.write(join(directory, assets.runtimePath.slice(1)), assets.runtime);
  if (assets.stylesheet && assets.stylesheetPath) await Bun.write(join(directory, assets.stylesheetPath.slice(1)), assets.stylesheet);
  if (assets.alpineChunk && assets.alpineChunkPath) await Bun.write(join(directory, assets.alpineChunkPath.slice(1)), assets.alpineChunk);
  for (const [assetPath, html] of Object.entries(documents)) await Bun.write(join(directory, assetPath.slice(1)), html);
}

async function bundleSource(source: string, outputFile: string, target: "bun" | "node" | "browser", edgeRuntime = false): Promise<void> {
  await mkdir(dirname(outputFile), { recursive: true });
  const entry = join(dirname(outputFile), `.brandy-entry-${crypto.randomUUID()}.ts`);
  const htmlRuntime = new URL("./html-runtime.ts", import.meta.url).pathname;
  await Bun.write(entry, source);
  try {
    const result = await Bun.build({
      entrypoints: [entry], outdir: dirname(outputFile), naming: basename(outputFile), target,
      minify: true, sourcemap: "linked", format: "esm",
      plugins: edgeRuntime ? [{
        name: "brandy-edge-runtime",
        setup(build) {
          build.onResolve({ filter: /^@elysiajs\/html$/ }, () => ({ path: htmlRuntime }));
          build.onResolve({ filter: /^node:async_hooks$/ }, (args) => ({ path: args.path, external: true }));
          build.onResolve({ filter: /^(?:node:)?(?:fs(?:\/promises)?|child_process|cluster|dgram|http2|net|tls|worker_threads)$/ }, (args) => {
            throw new Error(`${args.path} imported by ${args.importer} is unavailable in edge runtimes`);
          });
        },
      }] : [],
    });
    if (!result.success) {
      const details = result.logs.map((log) => `${log.message}${log.position?.file ? ` (${log.position.file}:${log.position.line})` : ""}`).join("\n");
      throw new Error(`Brandy ${target} build failed${details ? `:\n${details}` : ""}`);
    }
  } catch (error) {
    if (error instanceof AggregateError) {
      const details = error.errors.map((item) => item instanceof Error ? item.message : String(item)).join("\n");
      throw new Error(`Brandy ${target} build failed${details ? `:\n${details}` : ""}`, { cause: error });
    }
    throw error;
  } finally {
    await Bun.file(entry).delete();
  }
}

function adapterRejectsMutableCache(runtime: AdapterRuntime): boolean {
  return runtime !== "bun";
}

function outputDirectory(config: ResolvedConfig, configured: string | undefined, fallback: string): string {
  return configured ? resolve(config.root, configured) : fallback;
}

async function validateRuntimeSources(files: Iterable<string>, runtime: AdapterRuntime): Promise<void> {
  if (runtime === "bun") return;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\bBun\s*(?:\.|\[)/.test(source)) {
      throw new Error(`${file} uses the Bun global, which is unavailable in the ${runtime} adapter`);
    }
  }
}

async function renderStaticDocuments(
  manifest: RouteManifest,
  config: ResolvedConfig,
  assets: CompiledAssets,
): Promise<{ documents: Record<string, string>; routes: Record<string, string> }> {
  const app = await createBrandy({
    manifest,
    clientPath: assets.runtimePath,
    stylesheetPath: assets.stylesheetPath,
    alpineChunkPath: assets.alpineChunkPath,
    trustedOrigins: config.trustedOrigins,
    setup: config.setup,
    immutablePrerender: true,
    renderCacheMaxEntries: config.renderCacheMaxEntries,
  });
  const documents: Record<string, string> = {};
  const routes: Record<string, string> = {};
  for (const route of manifest.routes) {
    if (route.page.cache?.revalidateSeconds !== null || route.segments.some((segment) => segment.startsWith("["))) continue;
    const response = await app.handle(new Request(`http://brandy.local${route.pattern}`));
    if (response.status !== 200) continue;
    const assetPath = `/_brandy/pages/${contentHash(route.pattern)}.html`;
    documents[assetPath] = await response.text();
    routes[route.pattern] = assetPath;
  }
  return { documents, routes };
}

export async function buildApplication(config: ResolvedConfig): Promise<string> {
  const manifest = await buildManifest(config.appDir);
  const assets = await publicPaths(config.publicDir);
  const conflicts = assets.filter((path) => path.startsWith("/_brandy/") || manifest.routes.some((route) => !route.segments.some((segment) => segment.startsWith("[")) && route.pattern === path));
  if (conflicts.length) throw new Error(`Public files conflict with Brandy routes: ${conflicts.join(", ")}`);
  const styles = await compileStyles(config.styles, true);
  const alpineChunk = config.alpine ? await buildAlpineChunk() : undefined;
  const alpineChunkPath = alpineChunk ? `/_brandy/alpine.${contentHash(alpineChunk)}.js` : undefined;
  const runtime = await buildClientRuntime(alpineChunkPath ?? DEFAULT_ALPINE_CHUNK_PATH, false);
  const clientPath = `/_brandy/runtime.${contentHash(runtime)}.js`;
  const stylesheetPath = styles ? `/_brandy/app.${contentHash(styles)}.css` : undefined;
  const compiledAssets: CompiledAssets = {
    runtime, runtimePath: clientPath, stylesheet: styles, stylesheetPath,
    alpineChunk, alpineChunkPath,
  };
  if (adapterRejectsMutableCache(config.adapter.runtime)) {
    for (const route of manifest.routes) {
      if (route.page.cache?.revalidateSeconds !== null && route.page.cache) {
        throw new Error(`${route.page.file} exports \`revalidate\`, which requires a durable cache and is not supported by the ${config.adapter.runtime} adapter`);
      }
      if (route.page.cache && route.segments.some((segment) => segment.startsWith("["))) {
        throw new Error(`${route.page.file} prerenders a dynamic route, which requires static parameter enumeration on the ${config.adapter.runtime} adapter`);
      }
    }
  }

  const imports = new Map<string, string>();
  const imported = (file: string | undefined) => {
    if (!file) return undefined;
    let name = imports.get(file);
    if (!name) { name = `m${imports.size}`; imports.set(file, name); }
    return name;
  };
  for (const route of manifest.routes) {
    for (const layout of route.layouts) {
      imported(layout.file); imported(await nearest(layout.directory, config.appDir, ERROR_FILES));
      imported(await nearest(layout.directory, config.appDir, NOT_FOUND_FILES));
      imported(await ownFile(layout.directory, LOADING_FILES));
    }
    imported(route.page.file); imported(await nearest(route.page.directory, config.appDir, ERROR_FILES));
    imported(await nearest(route.page.directory, config.appDir, NOT_FOUND_FILES));
    imported(await ownFile(route.page.directory, LOADING_FILES));
    for (const intercepted of route.interceptedBy ?? []) {
      imported(intercepted.page.file); imported(await nearest(intercepted.page.directory, config.appDir, ERROR_FILES));
      imported(await nearest(intercepted.page.directory, config.appDir, NOT_FOUND_FILES));
      imported(await ownFile(intercepted.page.directory, LOADING_FILES));
    }
  }
  for (const action of manifest.actions.values()) imported(action.file);
  if (config.configFile) imported(config.configFile);
  await validateRuntimeSources(imports.keys(), config.adapter.runtime);

  const boundary = async (node: LayoutNode | PageNode, files: string[], key: string) => {
    const file = await nearest(node.directory, config.appDir, files); const name = imported(file);
    return name ? `, ${key}: ${name}.default` : "";
  };
  const ownBoundary = async (node: LayoutNode | PageNode, files: string[], key: string) => {
    const file = await ownFile(node.directory, files); const name = imported(file);
    return name ? `, ${key}: ${name}.default` : "";
  };
  const layouts = new Map<string, string>();
  for (const route of manifest.routes) for (const node of route.layouts) if (!layouts.has(node.file)) {
    const mod = imported(node.file)!;
    layouts.set(node.file, `{ id:${JSON.stringify(node.id)}, directory:${JSON.stringify(node.directory)}, file:${JSON.stringify(node.file)}, render:${mod}.default, load:${mod}.load, metadata:${mod}.metadata${await boundary(node, ERROR_FILES, "renderError")}${await boundary(node, NOT_FOUND_FILES, "renderNotFound")}${await ownBoundary(node, LOADING_FILES, "renderLoading")} }`);
  }
  const pageObjectCode = async (page: PageNode) => {
    const mod = imported(page.file)!;
    // Unlike render/load/metadata, `cache` is plain data already resolved by buildManifest —
    // serialize it directly rather than referencing a live export on the imported module.
    return `{ id:${JSON.stringify(page.id)}, directory:${JSON.stringify(page.directory)}, file:${JSON.stringify(page.file)}, render:${mod}.default, load:${mod}.load, metadata:${mod}.metadata, cache:${JSON.stringify(page.cache)}${await boundary(page, ERROR_FILES, "renderError")}${await boundary(page, NOT_FOUND_FILES, "renderNotFound")}${await ownBoundary(page, LOADING_FILES, "renderLoading")} }`;
  };
  const routes: string[] = [];
  for (const route of manifest.routes) {
    const page = route.page; const mod = imported(page.file)!;
    const pageCode = await pageObjectCode(page);
    const interceptedByCode = await Promise.all((route.interceptedBy ?? []).map(async (intercepted) =>
      `{ fromSegments:${JSON.stringify(intercepted.fromSegments)}, page:${await pageObjectCode(intercepted.page)} }`
    ));
    const interceptedByField = interceptedByCode.length ? `, interceptedBy:[${interceptedByCode.join(",")}]` : "";
    routes.push(`{ id:${JSON.stringify(route.id)}, pattern:${JSON.stringify(route.pattern)}, segments:${JSON.stringify(route.segments)}, layouts:[${route.layouts.map((item) => layouts.get(item.file)).join(",")}], page:${pageCode}, pageFile:${JSON.stringify(page.file)}, renderPage:${mod}.default${interceptedByField} }`);
  }
  const actions = [...manifest.actions.values()].map((action) => {
    const mod = imported(action.file)!;
    return `registerAction(${JSON.stringify(action.id)},${JSON.stringify(action.path)},${JSON.stringify(action.segmentPath)},${JSON.stringify(action.file)},${JSON.stringify(action.name)},${mod}[${JSON.stringify(action.name)}])`;
  });
  const prerenderSnapshot = await warmPrerenderCache(manifest);
  // Bun keeps prerendered routes in its mutable runtime cache so actions can revalidate them.
  // Only immutable serverless adapters should bypass the runtime with static documents.
  const staticOutput = adapterRejectsMutableCache(config.adapter.runtime)
    ? await renderStaticDocuments(manifest, config, compiledAssets)
    : { documents: {}, routes: {} };
  const serverImport = new URL("./server.ts", import.meta.url).pathname;
  const rootNotFoundModule = imported(await nearest(config.appDir, config.appDir, NOT_FOUND_FILES));
  const commonSource = `${[...imports].map(([file, name]) => `import * as ${name} from ${JSON.stringify(file)};`).join("\n")}
import { createBrandy } from ${JSON.stringify(serverImport)};
const actions = new Map();
function registerAction(id,path,segmentPath,file,name,handler){Object.defineProperty(handler,"toString",{configurable:true,value:()=>path});actions.set(path,{id,path,segmentPath,file,name,handler});}
${actions.join(";\n")}
const manifest={appDir:${JSON.stringify(config.appDir)},routes:[${routes.join(",\n")}],actions,rootNotFound:${rootNotFoundModule ? `${rootNotFoundModule}.default` : "undefined"}};
const config=${config.configFile ? `${imported(config.configFile)}.default ?? {}` : "{}"};
`;
  const appOptions = `manifest,clientPath:${JSON.stringify(clientPath)},stylesheetPath:${JSON.stringify(stylesheetPath)},alpineChunkPath:${JSON.stringify(alpineChunkPath)},trustedOrigins:config.trustedOrigins,setup:config.setup,dev:false,prerenderSnapshot:${JSON.stringify(prerenderSnapshot)},immutablePrerender:${adapterRejectsMutableCache(config.adapter.runtime)},renderCacheMaxEntries:${JSON.stringify(config.renderCacheMaxEntries)}`;
  const frameworkPaths = [clientPath, stylesheetPath, alpineChunkPath].filter((path): path is string => Boolean(path));
  const publicAssetPaths = await publicPaths(config.publicDir);
  const fingerprintedPublicAssetPaths = publicAssetPaths.filter(isFingerprintedPublicAsset);
  const builtAt = Date.now();
  const sourceMtime = await latestMtime([config.appDir, config.styles, config.publicDir, config.configFile]);
  const metadata = { version: 2, adapter: config.adapter.runtime, sourceMtime, builtAt, assets: { runtime: clientPath, stylesheet: stylesheetPath, alpine: alpineChunkPath } };

  if (config.adapter.runtime === "bun") {
    const output = outputDirectory(config, config.adapter.outputDir, config.outDir);
    const staticDir = join(output, "public");
    await resetDirectory(output);
    await writeStaticAssets(staticDir, config, compiledAssets, staticOutput.documents);
    const source = `${commonSource}
const app=await createBrandy({${appOptions}});
const staticAssets=new Set(${JSON.stringify([...publicAssetPaths, ...frameworkPaths])});
const immutablePublicAssets=new Set(${JSON.stringify(fingerprintedPublicAssetPaths)});
const publicRoot=${JSON.stringify(staticDir)};
const server=Bun.serve({port:Number(process.env.PORT)||${config.port},hostname:process.env.HOST||${JSON.stringify(config.host)},async fetch(request){const url=new URL(request.url);if((request.method==="GET"||request.method==="HEAD")&&request.headers.get("x-brandy-navigation")!=="1"){const path=staticAssets.has(url.pathname)?url.pathname:undefined;if(path){const file=Bun.file(publicRoot+path);if(await file.exists()){const isPageDocument=path.startsWith(${JSON.stringify("/_brandy/pages/")});const immutable=!isPageDocument&&(path.startsWith("/_brandy/")||immutablePublicAssets.has(path));const headers={"cache-control":isPageDocument?${JSON.stringify(REVALIDATE_PAGE_CACHE_CONTROL)}:immutable?${JSON.stringify(IMMUTABLE_ASSET_CACHE_CONTROL)}:"public, max-age=3600"};return new Response(request.method==="HEAD"?null:file,{headers});}}}return app.handle(request);}});
console.log(\`Brandy listening at \${server.url}\`);
`;
    await bundleSource(source, join(output, "server.js"), "bun");
    await Bun.write(join(output, "prerender-cache.json"), JSON.stringify(prerenderSnapshot, null, 2));
    await Bun.write(join(output, "build.json"), JSON.stringify(metadata, null, 2));
    return output;
  }

  if (config.adapter.runtime === "cloudflare") {
    const output = outputDirectory(config, config.adapter.outputDir, join(config.outDir, "cloudflare"));
    const staticDir = join(output, "assets");
    await resetDirectory(output);
    await writeStaticAssets(staticDir, config, compiledAssets, staticOutput.documents);
    const source = `${commonSource}
const app=await createBrandy({${appOptions}});
const staticRoutes=${JSON.stringify(staticOutput.routes)};
const staticAssets=new Set(${JSON.stringify([...publicAssetPaths, ...frameworkPaths])});
export default {async fetch(request,env){const url=new URL(request.url);if((request.method==="GET"||request.method==="HEAD")&&request.headers.get("x-brandy-navigation")!=="1"){const pageDocument=staticRoutes[url.pathname];const path=pageDocument??(staticAssets.has(url.pathname)?url.pathname:undefined);if(path){const assetRequest=new Request(new URL(path,request.url),request);const response=await env.ASSETS.fetch(assetRequest);if(pageDocument){const headers=new Headers(response.headers);headers.set("cache-control",${JSON.stringify(REVALIDATE_PAGE_CACHE_CONTROL)});return new Response(response.body,{status:response.status,headers});}if(path.startsWith("/_brandy/")){const headers=new Headers(response.headers);headers.set("cache-control",${JSON.stringify(IMMUTABLE_ASSET_CACHE_CONTROL)});return new Response(response.body,{status:response.status,headers});}return response;}}return app.fetch(request);}};
`;
    try {
      await bundleSource(source, join(output, "worker.js"), "browser", true);
    } catch (error) {
      throw new Error(`Cloudflare build failed. Loaders and setup code must not import Bun, filesystem, subprocess, or unsupported Node APIs.\n${String(error)}`, { cause: error });
    }
    await Bun.write(join(output, "wrangler.jsonc"), JSON.stringify({
      $schema: "./node_modules/wrangler/config-schema.json",
      name: config.adapter.projectName ?? basename(config.root), main: "./worker.js",
      compatibility_date: config.adapter.compatibilityDate,
      compatibility_flags: ["nodejs_compat"],
      assets: { directory: "./assets", binding: "ASSETS", run_worker_first: true },
    }, null, 2));
    await Bun.write(join(output, "build.json"), JSON.stringify(metadata, null, 2));
    return output;
  }

  const output = outputDirectory(config, config.adapter.outputDir, join(config.root, ".vercel/output"));
  const staticDir = join(output, "static");
  const functionDir = join(output, "functions/index.func");
  const functionEntry = config.adapter.runtime === "vercel-node" ? "index.mjs" : "index.js";
  await resetDirectory(output);
  await writeStaticAssets(staticDir, config, compiledAssets, staticOutput.documents);
  const source = `${commonSource}
const app=await createBrandy({${appOptions}});
export default {fetch(request){return app.fetch(request);}};
`;
  try {
    await bundleSource(source, join(functionDir, functionEntry), config.adapter.runtime === "vercel-node" ? "node" : "browser", config.adapter.runtime === "vercel-edge");
  } catch (error) {
    throw new Error(`Vercel ${config.adapter.runtime === "vercel-edge" ? "Edge" : "Node"} build failed because application code uses APIs unavailable in that runtime.\n${String(error)}`, { cause: error });
  }
  const functionConfig = config.adapter.runtime === "vercel-edge"
    ? { runtime: "edge", entrypoint: "index.js" }
    : { runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: true };
  await Bun.write(join(functionDir, ".vc-config.json"), JSON.stringify(functionConfig, null, 2));
  const routesConfig: Array<Record<string, unknown>> = [
    { src: "/.*", has: [{ type: "header", key: "x-brandy-navigation", value: "1" }], dest: "/index" },
    { src: "/_brandy/(?!pages/).*", headers: { "cache-control": IMMUTABLE_ASSET_CACHE_CONTROL }, continue: true },
    ...Object.entries(staticOutput.routes).map(([path, destination]) => ({
      src: `^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, dest: destination,
      headers: { "cache-control": REVALIDATE_PAGE_CACHE_CONTROL },
    })),
    { handle: "filesystem" },
    { src: "/.*", dest: "/index" },
  ];
  await Bun.write(join(output, "config.json"), JSON.stringify({ version: 3, routes: routesConfig, framework: { version: "0.0.1" } }, null, 2));
  await Bun.write(join(output, "build.json"), JSON.stringify(metadata, null, 2));
  return output;
}

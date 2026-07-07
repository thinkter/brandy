import type { Metadata, Params, RenderedRoute, RenderOptions, RouteDiff, RouteMatch, SyncRenderedRoute } from "./types.ts";
import { guardPersonalizedRequest } from "./personalization.ts";
import { renderFragmentMatch, renderFullMatch } from "./render.ts";

export interface RenderCacheEntry {
  html: string;
  metadata: Metadata;
  /** null = cached forever until an action explicitly revalidates it. */
  expiresAt: number | null;
}

export interface RenderCache {
  get(key: string): RenderCacheEntry | undefined;
  set(key: string, entry: RenderCacheEntry): void;
  delete(key: string): void;
}

/** Default cap on the number of entries an in-memory render cache holds at once. Chosen to bound
 * memory for a long-running server without needing per-deployment tuning; override via
 * `createMemoryRenderCache(maxEntries)` or `BrandyOptions.renderCacheMaxEntries` for larger/smaller
 * deployments. */
export const DEFAULT_RENDER_CACHE_MAX_ENTRIES = 750;

/** A bounded least-recently-used cache: `get` refreshes an entry's recency (delete + re-insert,
 * relying on `Map`'s insertion-order iteration), and `set` evicts the oldest entry once the
 * configured `maxEntries` is exceeded. This keeps an attacker from growing the cache without
 * bound by requesting unique `?q=`-style query strings — with a cap in place, unique keys churn
 * the oldest entries out instead of accumulating forever. */
export function createMemoryRenderCache(maxEntries: number = DEFAULT_RENDER_CACHE_MAX_ENTRIES): RenderCache {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error(`createMemoryRenderCache: maxEntries must be a positive integer, got ${maxEntries}`);
  }
  const store = new Map<string, RenderCacheEntry>();
  return {
    get(key) {
      const entry = store.get(key);
      if (entry === undefined) return undefined;
      // Touch-on-get: re-inserting moves the key to the end of Map's iteration order, marking
      // it most-recently-used.
      store.delete(key);
      store.set(key, entry);
      return entry;
    },
    set(key, entry) {
      store.delete(key);
      store.set(key, entry);
      while (store.size > maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    },
    delete(key) { store.delete(key); },
  };
}

/** The cache used by the running server. A route's own render objects are reconstructed fresh
 * per build/boot (see build.ts's codegen), so the key is built purely from primitive data —
 * never from object identity — which is also what lets a build-time-warmed snapshot be found
 * by the production server's freshly-constructed Route/PageNode instances. */
export const defaultRenderCache: RenderCache = createMemoryRenderCache();

function sortedParams(params: Params): string {
  return Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
}

/** Exported for reuse by build.ts's prerender warm-up pass, which writes entries under the
 * same keys this module reads at request time. */
export function keyFor(pattern: string, depth: number, params: Params, search: string): string {
  return `${pattern}::${depth}::${sortedParams(params)}::${search}`;
}

function isFresh(entry: RenderCacheEntry | undefined): entry is RenderCacheEntry {
  return entry !== undefined && (entry.expiresAt === null || entry.expiresAt > Date.now());
}

function toRendered(entry: RenderCacheEntry): SyncRenderedRoute {
  return { kind: "sync", html: entry.html, metadata: entry.metadata, status: 200 };
}

function writeThrough(cache: RenderCache, key: string, revalidateSeconds: number | null, rendered: RenderedRoute): void {
  if (rendered.kind !== "sync" || rendered.status !== 200) return;
  cache.set(key, { html: rendered.html, metadata: rendered.metadata, expiresAt: revalidateSeconds === null ? null : Date.now() + revalidateSeconds * 1000 });
}

export async function renderFullMatchCached(match: RouteMatch, request: Request, options: RenderOptions = {}, cache: RenderCache = defaultRenderCache): Promise<RenderedRoute> {
  const pageCache = match.route.page.cache;
  // Guard keys off "route has a cache config", not "cache is active" — the dev early-return
  // below must still see a guarded request so a personalized loader fails loudly in dev too,
  // before the mistake ever reaches a production cache.
  if (!pageCache) return renderFullMatch(match, request, options);
  const guarded = guardPersonalizedRequest(request, match.route.pattern);
  if (options.dev) return renderFullMatch(match, guarded, options);
  const depth = match.route.layouts.length;
  const key = keyFor(match.route.pattern, depth, match.params, new URL(request.url).search);
  const existing = cache.get(key);
  if (isFresh(existing)) return toRendered(existing);
  const rendered = await renderFullMatch(match, guarded, options);
  writeThrough(cache, key, pageCache.revalidateSeconds, rendered);
  return rendered;
}

export async function renderFragmentMatchCached(diff: RouteDiff, request: Request, options: RenderOptions = {}, cache: RenderCache = defaultRenderCache): Promise<RenderedRoute> {
  const pageCache = diff.target.route.page.cache;
  if (!pageCache) return renderFragmentMatch(diff, request, options);
  const guarded = guardPersonalizedRequest(request, diff.target.route.pattern);
  if (options.dev) return renderFragmentMatch(diff, guarded, options);
  const depth = diff.chainToRender.length;
  const key = keyFor(diff.target.route.pattern, depth, diff.target.params, new URL(request.url).search);
  const existing = cache.get(key);
  if (isFresh(existing)) return toRendered(existing);
  const rendered = await renderFragmentMatch(diff, guarded, options);
  writeThrough(cache, key, pageCache.revalidateSeconds, rendered);
  return rendered;
}

/** Write-only: always renders fresh (never reads the cache) and, if the target route is
 * cache-eligible, repopulates its entry. Used only by the action/`revalidate()` call site so a
 * manual revalidation is never served a stale hit. */
export async function renderFragmentMatchFresh(diff: RouteDiff, request: Request, options: RenderOptions = {}, cache: RenderCache = defaultRenderCache): Promise<RenderedRoute> {
  const pageCache = diff.target.route.page.cache;
  const guardedRequest = pageCache ? guardPersonalizedRequest(request, diff.target.route.pattern) : request;
  const rendered = await renderFragmentMatch(diff, guardedRequest, options);
  if (pageCache && !options.dev) {
    const depth = diff.chainToRender.length;
    const key = keyFor(diff.target.route.pattern, depth, diff.target.params, new URL(request.url).search);
    writeThrough(cache, key, pageCache.revalidateSeconds, rendered);
  }
  return rendered;
}

/** Loads a build-time prerender snapshot into the cache at server boot. Entries whose TTL has
 * already elapsed since the snapshot was written are skipped rather than served stale. */
export function applyRenderSnapshot(entries: Record<string, RenderCacheEntry>, cache: RenderCache = defaultRenderCache): void {
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.expiresAt === null || entry.expiresAt > Date.now()) cache.set(key, entry);
  }
}

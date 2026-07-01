# TODO

## Should fix soon

- [x] Design explicit client/server boundaries and per-island runtime delivery.
  Server-rendered TSX should remain the default, and completely static routes should not download Alpine. Add an explicit opt-in boundary, inspired by Astro islands and Next.js `"use client"`, so an interactive component can request its client runtime without making the rest of the page hydratable. Keep Brandy's navigation runtime independently configurable, define how island state behaves across fragment swaps, and evaluate whether the first version should initialize Alpine islands only or also support true component hydration.

- [x] Avoid mutating shared action-handler function objects in `loadActions` ([`src/core/walker.ts`](/home/ashman/Documents/opensource/brandy/src/core/walker.ts)).
  `@kitajs/html` stringifies attribute values with a bare `value.toString()`, and app code imports that JSX runtime directly, so Brandy has no render-layer hook to intercept — overriding `toString` on the handler itself is unavoidable. Added a module-level `WeakMap<Function, string>` (`actionPathsByHandler`) that records the path each handler is bound to: repeat binds to the same path (e.g. every dev rebuild re-touching the un-versioned canonical import) are now a no-op instead of a redundant mutation, and two different routes ever resolving to the same handler identity now throw instead of one path silently overwriting the other.

- [x] Replace HTML shell injection string replacement with a structural approach in [`src/core/render.ts`](/home/ashman/Documents/opensource/brandy/src/core/render.ts) and [`src/server.ts`](/home/ashman/Documents/opensource/brandy/src/server.ts).
  Shell insertion, duplicate-asset detection, and streaming document splitting now use a small HTML-aware scanner in [`src/core/html.ts`](/home/ashman/Documents/opensource/brandy/src/core/html.ts). It recognizes real tags and attributes while ignoring misleading closing-tag text inside comments, quoted attributes, and raw-text elements such as scripts and styles.

- [ ] Keep `REFRESH_BOUNDARY_HEADER` internal-only and document the constraint in [`src/server.ts`](/home/ashman/Documents/opensource/brandy/src/server.ts).
  This is currently a dev-HMR escape hatch that bypasses the diff engine's computed refresh boundary. That is acceptable as an internal mechanism, but it should not drift into a public or semi-public targeting API, especially for future features like intercepting routes.

- [ ] Add a production-quality dev safeguard for repeated full rebuilds and cache-busted dynamic imports in [`src/dev.ts`](/home/ashman/Documents/opensource/brandy/src/dev.ts).
  Every save rebuilds the route manifest from scratch and re-imports modules with a fresh cache-busting query string. Over a long Bun dev session, old module generations can accumulate in memory. Not urgent for short sessions, but worth guarding before long-lived development workflows rely on it.

## Feature roadmap

- [x] Separate the Bun build toolchain from portable deployment runtimes.
  Keep route discovery, Tailwind, bundling, filesystem access, and subprocesses at build time. Emit Bun standalone, Cloudflare Worker, Vercel Node, and Vercel Edge Fetch handlers with platform-native static assets and explicit serverless cache constraints.

- [ ] Parallel routes (`@slotname` outlets).
  The PRD's own P2 table calls this one "hairy, build dead last" — do it after everything else here is settled. Before starting: reassess scope against what intercepting routes just shipped. The original plan assumed parallel routes needed a new multi-target OOB wire mechanism (`data-brandy-outlet` templates, one per slot) that intercepting routes would then reuse for its modal. In practice, intercepting routes shipped by reusing the *existing* single-target retarget/reswap protocol unchanged (just pointing it at a different reserved selector) plus the streaming OOB template for the "clear" case — no new protocol was needed. Parallel routes may be able to lean on the same trick (each slot is just another reserved, auto-injected element id, retargeted independently) rather than requiring a genuinely new multi-outlet wire format; confirm this before designing the wire protocol from scratch. Also still open from the original plan: whether slots are co-resolved only (update because the primary route changed) or independently navigable via their own links/URLs — the latter needs real new state (client-side per-slot tracking, a `default.tsx` fallback convention, and a decision on whether slot state survives a hard refresh) and is a much bigger scope than the former.

## Performance roadmap

### High impact

- [x] Fingerprint production framework assets and serve them with immutable caching.
  Emit content-hashed runtime and stylesheet URLs, use `Cache-Control: public, max-age=31536000, immutable`, and document Brotli/gzip support at the server or deployment layer. Development assets should remain uncached.

- [x] Add explicit static generation and incremental revalidation controls.
  Support route exports such as `prerender = true` and `revalidate = 60` rather than guessing whether a loader is static. Precompute both complete documents and the fragments needed for soft navigation, with clear behavior for dynamic params, actions, errors, and authenticated requests.

- [x] Add request-scoped loader memoization.
  Deduplicate identical work within one render without sharing personalized or authenticated data between requests.

- [ ] Add an explicit cross-request cache API.
  A shared cache should require explicit keys, lifetimes, tags, and invalidation such as `revalidateTag`.

- [ ] Generalize route-level loading boundaries into server islands.
  Allow independently rendered server content to stream into a cached or already-rendered shell with a fallback. Define cold-load, partial-navigation, failure, metadata, and no-JavaScript behavior before exposing the API.

- [ ] Make prefetching cancellable, bounded, and aware of navigation conditions.
  Add `AbortController`, cache expiry and size limits, and avoid waste on constrained connections or abandoned hover targets. Preserve the invariant that a prefetched fragment is valid only for the route tree from which it was requested.

### Scale dependent

- [ ] Establish repeatable performance budgets and benchmarks before micro-optimizing.
  Track cold and warm TTFB, loader time, render time, fragment bytes, runtime bytes, startup time, and navigation/swap latency across small and large route manifests. Add regression thresholds for the metrics Brandy claims to improve.

- [ ] Compile route matching into a trie or similarly indexed structure.
  Replace the linear route scan only when large-manifest benchmarks show it matters, while preserving static-over-dynamic precedence and decoded parameter behavior.

- [ ] Evaluate route-level code splitting for the production server bundle.
  Lazy route chunks could reduce startup time and memory for large applications, but should be measured against first-request import latency and deployment environments that prefer a single bundle.

- [ ] Support multiple independently resolving streaming boundaries.
  Stream nested or sibling loading states as their loaders settle instead of selecting one boundary for the response. Specify ordering, error isolation, metadata reconciliation, and client reinitialization before changing the wire format.

- [ ] Evaluate opt-in DOM morphing while retaining replacement as the default.
  Morphing may preserve focus, selection, media, and local element state across server updates, but it adds runtime weight and reconciliation semantics. Keep predictable `innerHTML` replacement for applications that do not need it.

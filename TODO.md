# TODO

## Should fix soon

- [ ] Design explicit client/server boundaries and per-island runtime delivery.
  Server-rendered TSX should remain the default, and completely static routes should not download Alpine. Add an explicit opt-in boundary, inspired by Astro islands and Next.js `"use client"`, so an interactive component can request its client runtime without making the rest of the page hydratable. Keep Brandy's navigation runtime independently configurable, define how island state behaves across fragment swaps, and evaluate whether the first version should initialize Alpine islands only or also support true component hydration.

- [ ] Avoid mutating shared action-handler function objects in `loadActions` ([`src/core/walker.ts`](/home/ashman/Documents/opensource/brandy/src/core/walker.ts)).
  Today `loadActions` patches `handler.toString` directly on the live function object returned from the module cache. With concurrent manifest builds, that means shared global state is being mutated across imports. At minimum, document the fragility. Prefer a non-mutating identity mechanism such as a `WeakMap<Function, string>` from handler to action path.

- [ ] Replace HTML shell injection string replacement with a structural approach in [`src/core/render.ts`](/home/ashman/Documents/opensource/brandy/src/core/render.ts) and [`src/server.ts`](/home/ashman/Documents/opensource/brandy/src/server.ts).
  `injectMetadata`, `injectClientRuntime`, `injectStylesheet`, and `injectDevRuntime` currently inject by replacing literal `</head>` or `</body>`. If the root layout contains those substrings inside inline scripts, JSON, or attributes, injection can silently land in the wrong place.

- [ ] Keep `REFRESH_BOUNDARY_HEADER` internal-only and document the constraint in [`src/server.ts`](/home/ashman/Documents/opensource/brandy/src/server.ts).
  This is currently a dev-HMR escape hatch that bypasses the diff engine's computed refresh boundary. That is acceptable as an internal mechanism, but it should not drift into a public or semi-public targeting API, especially for future features like intercepting routes.

- [ ] Add a production-quality dev safeguard for repeated full rebuilds and cache-busted dynamic imports in [`src/dev.ts`](/home/ashman/Documents/opensource/brandy/src/dev.ts).
  Every save rebuilds the route manifest from scratch and re-imports modules with a fresh cache-busting query string. Over a long Bun dev session, old module generations can accumulate in memory. Not urgent for short sessions, but worth guarding before long-lived development workflows rely on it.

## Performance roadmap

### High impact

- [ ] Fingerprint production framework assets and serve them with immutable caching.
  Emit content-hashed runtime and stylesheet URLs, use `Cache-Control: public, max-age=31536000, immutable`, and document Brotli/gzip support at the server or deployment layer. Development assets should remain uncached.

- [ ] Add explicit static generation and incremental revalidation controls.
  Support route exports such as `prerender = true` and `revalidate = 60` rather than guessing whether a loader is static. Precompute both complete documents and the fragments needed for soft navigation, with clear behavior for dynamic params, actions, errors, and authenticated requests.

- [ ] Add request-scoped loader memoization, followed by an explicit cross-request cache API.
  Deduplicate identical work within one render first. A shared cache should require explicit keys, lifetimes, tags, and invalidation such as `revalidateTag`, and must prevent personalized or authenticated data from leaking between requests.

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

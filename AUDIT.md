# Brandy Codebase Audit

**Date:** 2026-07-02

## Overall verdict

Unusually disciplined codebase for a v0.0.1 — the PRD is genuinely load-bearing, the core is small and readable, and the hard thing (the diff) is pure and tested. 83/83 tests pass, typecheck clean. Problems are mostly in the seams the PRD itself flagged as risky: caching, progressive enhancement under streaming, and the client runtime (least-tested, most invariant-critical code).

## Serious concerns

- [ ] **Prerender cache has no personalization guard (biggest issue).** `prerender = true` caches the entire rendered output including every ancestor layout (`src/core/cache.ts:55-77`), and loaders receive the full `Request` with cookies and auth headers. Nothing detects or warns when a cached route reads per-user data, so the first visitor's personalized page or layout shell is served to everyone. Also, `keyFor` includes the raw query string (`cache.ts:38-40`) and the memory cache has no size cap or LRU — an attacker can grow it without bound by requesting unique `?q=` values on any cached route.

- [ ] **Serverless adapters serve prerendered page HTML with `immutable, max-age=31536000` on user-facing URLs.** Vercel (`src/build.ts:343-346`) and Cloudflare (worker code at `build.ts:303`) attach the year-long immutable header to responses for e.g. `/about`, not just fingerprinted assets. Returning visitors' browsers never re-request the URL, so redeploys are invisible to them forever.

- [ ] **Malformed URLs crash the server; params are double-decoded.** `normalizePathname("/%")` throws `URIError` (`src/core/path.ts:3`), so `GET /%` escapes the fallback handler uncaught → 500. `normalizePathname` runs `decodeURI` and then `paramsFor` runs `decodeURIComponent` on the same string (`src/core/diff.ts:16`), so `/users/%2541` yields param `"A"` instead of `"%41"` — a correctness bug and a classic path-filter-bypass pattern.

- [ ] **In-page anchor links are broken.** The click handler (`src/client/runtime.ts:337-348`) doesn't check hash or same-page, so `<a href="#section">` triggers a full fragment fetch/swap and `pushState` drops the hash — the browser never scrolls to the anchor.

- [ ] **No navigation sequencing.** `navigate()` has no latest-wins guard or `AbortController`: if a slow response A lands after a later click B, it overwrites B's DOM and `renderedURL`.

- [ ] **Streaming cold loads violate the progressive-enhancement promise.** A no-JS cold load of a route with `loading.tsx` flushes the skeleton then delivers real content as an inline `<script>` (`src/core/render.ts:130-132`) — no-JS users see the skeleton forever. Also CSP-hostile (inline script, no nonce support).

- [ ] **`x-brandy-refresh-boundary` is honored from any client in production** (`src/server.ts:313-321`) despite the TODO saying it must stay internal-only. It isn't gated on `dev` — anyone can steer the render boundary.

- [ ] **Dev server permanently breaks if a directory containing `actions.ts` is renamed.** `actionPathsByHandler` is module-level and persists across rebuilds (`src/core/walker.ts:67`); the canonical import keeps its function identity, so binding to the new path throws "already bound" on every rebuild until restart.

## Medium

- [ ] **The diff engine exists twice.** `diffRoutes` (`core/diff.ts:28`) and `diffMatches` (`server.ts:143`) hand-roll the same longest-common-prefix walk. Extract a shared `diffLayoutChains(current, target)`.

- [ ] **Cold-load responses don't send `Vary`.** Fragment responses set `Vary: x-brandy-navigation, x-brandy-current-url`; full documents don't (`server.ts:333-349`), so a CDN can serve the full document to a fragment request. Degrades to `location.assign` but silently defeats partial navigation behind any cache.

- [ ] **No scroll or focus management.** After a swap the old scroll offset persists on a new "page"; popstate restores nothing; no focus/announcement for screen readers.

- [ ] **Streaming error paths swallow errors silently.** Two bare `catch {}` blocks in `renderPipelineStreaming` (`render.ts:181-184, 193-195`) discard errors — no logging, no error boundary for the ancestor phase, hardcoded English fallback text, and streamed responses are always 200.

- [ ] **Route precedence sorts by total dynamic-segment count, not per-position** (`walker.ts:214-218`). `/[a]/b` vs `/a/[b]` ties fall to `localeCompare` where `[` sorts first, so `/a/b` matches `/[a]/b` — opposite of Next's static-first-per-segment rule.

- [ ] **Route groups `(marketing)` silently become literal URL segments.** `parseInterceptMarker` only recognizes dot markers, so a `(group)` directory produces the URL `/(marketing)/page` with no error. Unknown parenthesized directories should throw. Catch-all `[...slug]` and `generateStaticParams` are also absent — parity gaps not listed in the README.

- [ ] **No `redirect()` for loaders.** No way to redirect from a loader (actions can return a `Response`; loaders can't); no middleware concept — the auth story is undefined for the target audience (dashboards/CRUD).

- [ ] **Action context is built from a client-controlled header.** `params` and `url` passed to action handlers derive from `x-brandy-current-url`/referer (`server.ts:251-253`); handlers trusting `context.params` can be aimed at arbitrary route params, and `url` drops the current page's query string.

- [ ] **The client runtime (372 lines, half the "central invariant") has zero tests.** All test coverage is server-side; prefetch cache, stream splitting, history handling, and OOB reconciliation are untested.

- [ ] **Dependency hygiene:** `@kitajs/html` is imported directly (`src/html-runtime.ts:1`) but is only a transitive dependency (phantom dep); `elysia` is a direct dependency but never imported; the PRD still says "Server framework: Elysia" though it's been replaced by `BrandyApplication`.

- [ ] **`x-brandy-prefetch` is dead on the server.** The client sends it, nothing reads it — prefetch can't skip expensive work or get distinct cache policy; the prefetch cache also never expires.

- [ ] **Dev SSE cleanup bug:** the `cancel(controller)` callback in `dev.ts:24` receives the cancellation reason, not the controller, so disconnected clients are only pruned when the next `send()` throws.

## Low-hanging

- [ ] `data-brandy-reload`, `data-brandy-no-prefetch`, and `data-brandy-no-intercept` are undocumented; they're also "plumbing" attributes the PRD's risk register should acknowledge.

- [ ] `Island` forces a wrapper `<div>` that affects layout — offer a `tag` prop or `display: contents`. No `[x-cloak]{display:none}` CSS is injected, so Alpine's cloak idiom flashes.

- [ ] No `<link rel="modulepreload">` for the Alpine chunk when the initial document contains islands — first interaction pays a serial network fetch.

- [ ] Bun adapter writes prerendered HTML documents to disk but hardcodes `staticRoutes={}` (`build.ts:282`) — dead files.

- [ ] `dist/brandy.js` is a stale committed artifact; `build:client` looks obsolete.

- [ ] No CI (`.github/` doesn't exist) — a workflow running `bun test` + `tsc --noEmit` would protect the invariants.

- [ ] No trailing-slash canonicalization: `/about/` and `/about` both 200 with identical content; conventionally 308 to canonical.

- [ ] HEAD requests to streaming routes return the full body (`server.ts:334-343` handles HEAD only on the sync path).

- [ ] Public assets on the Bun adapter get no cache headers at all.

- [ ] `resolveMatch` detects missing routes by matching the error message string — use a typed error class.

- [ ] Error/not-found partial navs return `metadata: {}`, leaving the previous page's title in place.

- [ ] GET form submits silently drop file inputs and non-string values (`runtime.ts:359-361`).

## Philosophy scorecard

**Strong:** the core bet is delivered — the diff is pure, standalone, tested exactly as M0 demanded; the D2 seam (reinit hook, `ensureIsland`, no shared state with Alpine) is honored; intercepting routes reusing the existing retarget protocol was the right call; the TODO shows real editorial judgment.

**Lacking:** (a) the no-JS guarantee has a hole under streaming with no decision on whether that's a scoped exception or a bug; (b) "one hard thing, well done" is contradicted by the diff existing twice; (c) the PRD's top risk — double-render discipline — has no mitigation built: nothing warns when a template only works full-wrapped; (d) the target user's first real app is blocked on the missing redirect/auth story; (e) caching semantics are the one place the project guessed instead of specifying — prerender shipped without answering "what happens when a cached route touches the request."

**Suggested fix order:** serious #1–#3 before any real deployment; #4/#5 plus client-runtime tests next; then loader `redirect()`; then diff dedup and PRD refresh.

# Brandy Codebase Audit

**Date:** 2026-07-02
**Progress updated:** 2026-07-07

## Overall verdict

Unusually disciplined codebase for a v0.0.1 — the PRD is genuinely load-bearing, the core is small and readable, and the hard thing (the diff) is pure and tested. 83/83 tests pass, typecheck clean. Problems are mostly in the seams the PRD itself flagged as risky: caching, progressive enhancement under streaming, and the client runtime (least-tested, most invariant-critical code).

## Progress since the audit (as of 2026-07-07)

All 26 audit findings were filed as GitHub issues (#1–#32, some findings sharing an issue). Current burn-down:

- **Medium (12 issues, #9–#20):** all fixed and merged (PRs #33–#44).
- **Low-hanging (12 issues, #21–#32):** all fixed and merged (`integrate/low-hanging` batch).
- **Serious (8 issues, #1–#8):** #8 fixed and merged (PR #45); #2, #3, #4, #5, #7 fixed, in review (PRs #46–#49); #1 and #6 remain open pending design decisions.

See [STATUS.md](STATUS.md) for the live tracker.

## Serious concerns

- [ ] **Prerender cache has no personalization guard (biggest issue).** `prerender = true` caches the entire rendered output including every ancestor layout (`src/core/cache.ts:55-77`), and loaders receive the full `Request` with cookies and auth headers. Nothing detects or warns when a cached route reads per-user data, so the first visitor's personalized page or layout shell is served to everyone. Also, `keyFor` includes the raw query string (`cache.ts:38-40`) and the memory cache has no size cap or LRU — an attacker can grow it without bound by requesting unique `?q=` values on any cached route. — **Open (#1); needs a design decision on the personalization guard.**

- [x] **Serverless adapters serve prerendered page HTML with `immutable, max-age=31536000` on user-facing URLs.** Vercel (`src/build.ts:343-346`) and Cloudflare (worker code at `build.ts:303`) attach the year-long immutable header to responses for e.g. `/about`, not just fingerprinted assets. Returning visitors' browsers never re-request the URL, so redeploys are invisible to them forever. — **Fixed in PR #49 (in review):** page documents get `max-age=0, must-revalidate`; only fingerprinted assets stay immutable.

- [x] **Malformed URLs crash the server; params are double-decoded.** `normalizePathname("/%")` throws `URIError` (`src/core/path.ts:3`), so `GET /%` escapes the fallback handler uncaught → 500. `normalizePathname` runs `decodeURI` and then `paramsFor` runs `decodeURIComponent` on the same string (`src/core/diff.ts:16`), so `/users/%2541` yields param `"A"` instead of `"%41"` — a correctness bug and a classic path-filter-bypass pattern. — **Fixed in PR #47 (in review):** matching operates on the raw pathname, params decode exactly once, malformed encoding → 400.

- [x] **In-page anchor links are broken.** The click handler (`src/client/runtime.ts:337-348`) doesn't check hash or same-page, so `<a href="#section">` triggers a full fragment fetch/swap and `pushState` drops the hash — the browser never scrolls to the anchor. — **Fixed in PR #48 (in review):** same-document hash links are left to native browser handling.

- [x] **No navigation sequencing.** `navigate()` has no latest-wins guard or `AbortController`: if a slow response A lands after a later click B, it overwrites B's DOM and `renderedURL`. — **Fixed in PR #48 (in review):** monotonic navigation token + per-navigation `AbortController`, re-checked after every await including per-chunk during streaming.

- [ ] **Streaming cold loads violate the progressive-enhancement promise.** A no-JS cold load of a route with `loading.tsx` flushes the skeleton then delivers real content as an inline `<script>` (`src/core/render.ts:130-132`) — no-JS users see the skeleton forever. Also CSP-hostile (inline script, no nonce support). — **Open (#6); needs a decision on whether streaming may assume JS (see PRD §12).**

- [x] **`x-brandy-refresh-boundary` is honored from any client in production** (`src/server.ts:313-321`) despite the TODO saying it must stay internal-only. It isn't gated on `dev` — anyone can steer the render boundary. — **Fixed in PR #46 (in review):** header only honored when `options.dev` is set; production treats it as absent.

- [x] **Dev server permanently breaks if a directory containing `actions.ts` is renamed.** `actionPathsByHandler` is module-level and persists across rebuilds (`src/core/walker.ts:67`); the canonical import keeps its function identity, so binding to the new path throws "already bound" on every rebuild until restart. — **Fixed and merged (PR #45):** the binding map resets at the start of every manifest walk.

## Medium — all fixed and merged

- [x] **The diff engine exists twice.** Extracted into shared `diffLayoutChains` (PR #33, issue #9).
- [x] **Cold-load responses don't send `Vary`.** Full-document responses now emit `Vary` (PR #34, issue #10).
- [x] **No scroll or focus management.** Scroll restoration, focus management, and a11y announcements added (PR #35, issue #11).
- [x] **Streaming error paths swallow errors silently.** Errors are logged, marked, use a configurable fallback, and set a real HTTP status (PR #42, issue #12).
- [x] **Route precedence sorts by total dynamic-segment count, not per-position.** Now sorted by per-segment specificity (PR #37, issue #13).
- [x] **Route groups `(marketing)` silently become literal URL segments.** Route groups recognized; unknown parenthesized directories throw (PR #39, issue #14).
- [x] **No `redirect()` for loaders.** `redirect()` helper added for loaders (PR #43, issue #15). Middleware remains future work.
- [x] **Action context is built from a client-controlled header.** Action context now derives from server-trusted sources (PR #40, issue #16).
- [x] **The client runtime has zero tests.** Client-runtime test harness (happy-dom) and coverage added (PR #44, issue #17).
- [x] **Dependency hygiene.** `@kitajs/html` made a direct dep, dead `elysia` dep removed, PRD drift fixed (PR #38, issue #18).
- [x] **`x-brandy-prefetch` is dead on the server.** `isPrefetch` exposed on loader context; prefetch cache got TTL/LRU (PR #41, issue #19).
- [x] **Dev SSE cleanup bug.** SSE controller captured in closure so `cancel()` prunes disconnected clients (PR #36, issue #20).

## Low-hanging — all fixed and merged (issues #21–#32, `integrate/low-hanging` batch)

- [x] Navigation escape-hatch attributes documented (#21).
- [x] Island wrapper/`x-cloak` polish (#22).
- [x] `modulepreload` for the Alpine chunk on documents with islands (#23).
- [x] Dead Bun static prerender files removed (#24).
- [x] Stale `dist/brandy.js` artifact and obsolete `build:client` removed (#25).
- [x] CI added: Bun checks on pushes and PRs (`.github/workflows/ci.yml`) (#26).
- [x] Trailing-slash requests canonicalized (#27).
- [x] HEAD requests handled on streaming routes (#28).
- [x] Bun public assets get appropriate cache headers (#29).
- [x] Route-not-found failures use a typed error class (#30).
- [x] Error/not-found partial navs no longer leave stale metadata (#31).
- [x] GET form submits no longer silently drop file inputs / non-string values (#32).

## Philosophy scorecard

**Strong:** the core bet is delivered — the diff is pure, standalone, tested exactly as M0 demanded; the D2 seam (reinit hook, `ensureIsland`, no shared state with Alpine) is honored; intercepting routes reusing the existing retarget protocol was the right call; the TODO shows real editorial judgment.

**Lacking (2026-07-02, annotated 2026-07-07):** (a) the no-JS guarantee has a hole under streaming with no decision on whether that's a scoped exception or a bug — **still open (#6)**; (b) "one hard thing, well done" is contradicted by the diff existing twice — **fixed (PR #33)**; (c) the PRD's top risk — double-render discipline — has no mitigation built: nothing warns when a template only works full-wrapped — **still open, untracked**; (d) the target user's first real app is blocked on the missing redirect/auth story — **partially fixed: loader `redirect()` shipped (PR #43); middleware still absent**; (e) caching semantics are the one place the project guessed instead of specifying — prerender shipped without answering "what happens when a cached route touches the request" — **still open (#1)**.

**Suggested fix order:** ~~serious #1–#3 before any real deployment; #4/#5 plus client-runtime tests next; then loader `redirect()`; then diff dedup and PRD refresh~~ — everything here is done or in review except the two design-decision items: **#1 (prerender personalization guard) and #6 (streaming vs. the no-JS promise)**.

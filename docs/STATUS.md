# Project Status

**Updated:** 2026-07-07

Live tracker for the hardening pass triggered by the [2026-07-02 audit](AUDIT.md). The audit's 26 findings were filed as GitHub issues #1–#32; this page tracks their burn-down and what's next.

## Where things stand

| Tier | Issues | State |
|---|---|---|
| Serious | #1–#8 | 1 merged, 5 in review, **2 open (design decisions needed)** |
| Medium | #9–#20 | All fixed and merged (PRs #33–#44) |
| Low-hanging | #21–#32 | All fixed and merged (`integrate/low-hanging` batch) |

## Serious issues — detail

| Issue | Fix | State |
|---|---|---|
| #8 Dev server breaks on `actions.ts` directory rename | PR #45 | **Merged** |
| #7 `x-brandy-refresh-boundary` honored in production | PR #46 | In review |
| #3 Malformed URLs 500; params double-decoded | PR #47 | In review |
| #4 In-page anchor links fetch instead of scrolling | PR #48 | In review |
| #5 No navigation sequencing (stale responses clobber newer navs) | PR #48 | In review |
| #2 Prerendered page HTML served with year-long immutable cache | PR #49 | In review |
| #1 Prerender cache: no personalization guard, unbounded memory | — | **Open — needs design** |
| #6 Streaming cold loads break the no-JS promise; inline script lacks nonce | — | **Open — needs design** |

## Next: the two design discussions

**#1 — Prerender personalization guard.** The mechanical half (LRU-bound the cache, decide query-string handling in `keyFor`) can ship any time. The design half: how to stop a cached route from leaking per-user data. Leading option: wrap the `Request` handed to prerendered loaders in a proxy that throws (or dev-warns) on cookie/auth-header access, making the leak impossible by construction rather than relying on a lint. Also to decide: whether personalized routes opt out of `prerender`, or `prerender` strips per-user data by construct.

**#6 — Streaming vs. the no-JS promise.** The PRD's principle 4 ("progressive enhancement by construction") currently has a hole under streaming. Options on the table: (1) stream real content as HTML chunks so no-JS users get it; (2) add nonce support to the inline script and document the JS-required assumption as a scoped exception in the PRD; (3) skip the skeleton on cold load. Option 1 is the only one that keeps the promise fully honest; it is also the largest change (render-pipeline core).

## Still-open follow-ups (non-audit)

- Double-render discipline has no mitigation: nothing warns when a template only renders correctly full-wrapped (PRD's top technical risk; untracked).
- Middleware concept for cross-cutting auth (loader `redirect()` shipped in #15; middleware future work).
- Roadmap items in [TODO.md](TODO.md): parallel routes, cross-request cache API, server islands, prefetch condition-awareness, performance budgets.
- ~24 pre-existing typecheck errors on `main` (DOM-lib typing in the happy-dom test harness; `tsconfig` uses `types: ["bun"]` only). Not user-facing, but noise in every `bun run typecheck`.

## Documents

- [prd.md](prd.md) — product requirements (Draft v0.3, 2026-07-07)
- [AUDIT.md](AUDIT.md) — 2026-07-02 audit with per-finding resolution state
- [TODO.md](TODO.md) — engineering to-dos and roadmap

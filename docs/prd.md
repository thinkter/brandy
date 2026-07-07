# Brandy — Product Requirements Document

**Status:** Draft v0.3
**Last updated:** 2026-07-07
**Owner:** @thinkter
**One-liner:** Next.js App Router conventions, delivered as HTML over the wire — no React, no RSC.

---

## 1. TL;DR

Brandy is a web framework that takes the *developer experience* of the Next.js App Router — file-system routing, nested layouts, persistent shells, partial navigation — and detaches it from React entirely. It renders HTML on the server and swaps fragments on the client, htmx-style.

The core bet: the App Router's nested-layout tree is **secretly a description of swap targets**. Brandy computes, on every navigation, the deepest layout the old and new URL share, renders only the part that diverged, and swaps it into that layout's outlet. The route tree *is* the wiring, so the developer never hand-writes a target, a swap directive, or a frame id. They write a function and a plain `<a>`.

Client-side interactivity (dropdowns, toggles, optimistic UI) is explicitly **not** Brandy's job — it's delegated to Alpine.js by default. Brandy owns navigation and data; Alpine owns client state.

---

## 2. Problem & Motivation

The modern web framework default — React + an SPA bundle — is overkill for a large class of applications whose source of truth lives on the server (CRUD apps, dashboards, content sites, internal tools). For these, shipping a client-side framework to re-render server state is wasted weight and complexity.

htmx and the hypermedia approach solve this elegantly for *server-state interactivity*, but they require manual per-element wiring (`hx-target`, `hx-swap`, frame ids) and offer no opinion on app structure. Meanwhile, the thing developers genuinely love about the Next.js App Router — its file-system conventions and persistent nested layouts — is welded to React Server Components and ships React whether you want it or not.

**The gap:** nobody has cleanly delivered App Router *ergonomics* (FS routing, nested layouts, partial rendering) in the HTML-over-the-wire world. Turbo (Hotwire) gets the closest on the mechanics but requires explicit `<turbo-frame>` tagging rather than deriving structure from the file system.

Brandy fills exactly that gap.

## 3. Target User & Positioning

**Primary user:** the developer who loves the Next.js App Router developer experience but does not want React, RSC, or a client-side SPA. They are comfortable with server-rendered HTML and want structure and convention without a virtual DOM.

This is a **deliberately narrow niche**, and that is acknowledged as a risk (see §11). The defensibility comes from the fact that this exact user is currently served by *nobody*: people who want App Router DX reach for Next (and get React); people who want hypermedia reach for htmx/Turbo (and get no FS-routing conventions). Brandy is the only thing in the overlap.

**Positioning vs. neighbors:**

| Framework | Routing model | Client cost | Brandy's difference |
|---|---|---|---|
| Next.js App Router | FS-based, nested layouts | React + RSC runtime | Same conventions, zero React |
| Remix | FS-based, nested layouts | React | HTML over wire, no React |
| Turbo / Hotwire | Explicit `<turbo-frame>` | Tiny | Routing & targets derived from FS, not hand-tagged |
| htmx (raw) | None (per-element) | Tiny | Adds structure, conventions, derived targeting |
| Datastar | None (signals + SSE) | ~14kb | Adds App Router conventions; different scope |
| Astro | FS-based, islands | ~0 by default | Persistent layouts + partial navigation; Astro re-renders whole pages |
| SvelteKit | FS-based, nested layouts | Svelte runtime | HTML over the wire; no compiler, no client framework |

In practice the competition is less htmx than Astro and SvelteKit — the frameworks people actually reach for when leaving React. Against those, Brandy's differentiator is specifically persistent nested layouts with *derived* partial navigation, not merely "less JavaScript."

## 4. Goals / Non-Goals

**Goals**
- File-system routing with nested, persistent layouts.
- Partial navigation: only the diverged segment re-renders and swaps; shared layouts stay mounted.
- "Files, no plumbing" — the developer never writes a swap target, swap mode, or frame id.
- Works without JavaScript (full-page render); gets surgical with JS on (progressive enhancement by construction).
- Server-side type safety between a segment's loader and its template.
- Server-driven mutations with a clean colocated convention.

**Non-Goals**
- A typed client→server RPC stub (Eden / Server-Actions-as-imported-functions). Brandy submits forms and returns HTML; it does not call typed functions across the wire. This is the conscious trade for choosing HTML-over-the-wire over RSC.
- Owning client-side reactivity. Brandy will **not** build a signals system, binding layer, or DOM reconciliation. That is a dependency's job, forever (see Decision D2).
- A full RSC-style server/client component model.

## 5. Core Concept

A URL is a **path through the layout tree**:

```
/dashboard/settings   →  [app/layout, dashboard/layout, settings/page]
/dashboard/analytics  →  [app/layout, dashboard/layout, analytics/page]
```

Navigating between two URLs:
1. Compute both layout chains.
2. Take the **longest common prefix** → `[app/layout, dashboard/layout]`.
3. The first point of divergence is the **swap boundary**.
4. Render from the divergence down (`analytics/page`) and swap it into the outlet of the deepest *shared* layout (`dashboard/layout`'s slot).

The diff produces two things that must always agree: the **HTML fragment** and the **selector to retarget it into**. Keeping that coupling airtight is the central invariant of the system.

Cold load (no partial-nav header) renders the full document top-to-bottom; soft navigation renders only the diverged slice. Same route handlers, two render modes, switched on a request header.

## 6. Design Principles

1. **The href is the wiring.** All navigation intent is expressed by where a link points; the diff derives the rest. There is nothing to wire because the route tree already answers every "where does this go" question.
2. **Files, no plumbing.** A developer authors functions that return HTML and plain `<a>`/`<form>` elements. No attributes for targeting or swapping.
3. **Navigation & data are Brandy's job; client state is a dependency's job.** This line is load-bearing and documented (Decision D2).
4. **Progressive enhancement by construction**, not as an afterthought: no-JS path is the full render; JS path is the partial swap.
5. **One hard thing, well done.** The diff engine is the only genuinely novel component; everything else is plumbing or a known pattern.

## 7. Technical Stack

- **Build tool & dev runtime:** Bun
- **Request runtime:** Brandy's own portable `BrandyApplication` router (Fetch request → response), emitted per deployment adapter: Bun standalone, Cloudflare Workers, Vercel Node/Edge.
- **Templating:** server-side JSX via `@elysiajs/html` (returns strings; no hydration)
- **Styling:** Tailwind CSS
- **Client interactivity (adopted, not built):** Alpine.js, delivered lazily per `<Island>` boundary; set `alpine: false` to opt out while keeping Brandy navigation.
- **Transport:** HTML fragments over HTTP, htmx-style swapping (via Brandy's own thin runtime).

Note: Brandy originally sat on top of Elysia's explicit router; it now owns a minimal portable request runtime so one build pipeline can target Bun, Cloudflare, and Vercel (see D5). Server JSX still renders through `@elysiajs/html`'s runtime, and typed RPC is intentionally not offered on the client; type safety is retained server-side between loader and template.

## 8. Architecture

The system is a boot-time route builder plus a request pipeline:

1. **FS walker** crawls `app/`, identifies `layout.tsx` / `page.tsx`, builds the route tree and each route's layout chain (metadata precomputed at boot).
2. On request, **diff engine** computes the swap boundary from current + target URL.
3. **Render layer** composes JSX down the chain, either naked (partial) or full-wrapped (cold).
4. **Slot-id injection** stamps ids on layout outlets so the diff has a target.
5. **Header glue** reads the partial-nav header inbound, emits retarget + reswap outbound.
6. **Client runtime** (~3kb) intercepts internal links/forms, fetches, swaps at the targeted slot, updates history — and re-initializes the adopted client library after each swap.

## 9. Feature Requirements

Priorities: **P0** = core spine (a thing that navigates). **P1** = makes it usable. **P2** = differentiators / long tail.

### 9.1 Core spine (P0) — build in this order

| # | Feature | Requirement |
|---|---|---|
| 1 | FS walker | Crawl `app/`; build route tree + per-route layout chain at boot. |
| 2 | **Diff engine** | Pure function `(currentURL, targetURL) → {boundary, chainToRender}` via longest-common-prefix. **The heart. Build first, standalone, unit-tested.** |
| 3 | Render layer | Server JSX → strings; nest `{children}` down chain; render naked or full-wrapped. |
| 4 | Slot-id injection | Framework stamps outlet ids; developer never names a slot. |
| 5 | Header glue | Read partial-nav header in; emit retarget + reswap out. |
| 6 | Client runtime | ~3kb: intercept internal `<a>`/`<form>`, fetch, swap at target, `pushState`. No-JS fallback = full nav. **Constraint:** stays reactivity-agnostic — calls one documented re-init hook after each swap, shares no state with the adopted library (the seam, Decision D2). |

### 9.2 Makes-it-real (P1)

| # | Feature | Requirement |
|---|---|---|
| 7 | Loaders | A `load` per segment; run from divergence down, in parallel; typed into the template. |
| 8 | Back/forward | `popstate` handled as **re-diff against the popped URL** — explicitly *not* htmx's innerHTML snapshot cache. (Sharpest hidden edge; do not skip.) |
| 9 | Head / metadata | Per-segment `metadata` export, reconciled via out-of-band swap on partial nav so title/meta don't go stale. |
| 10 | Mutations / Server Actions | See §10. Colocated `actions.ts`; form post → handler → fragment + OOB side-effect swaps. |
| 11 | Error boundaries | `error.tsx`; a segment loader throws → catch at the segment → swap error fragment into that slot, leaving surrounding layout intact. |
| 12 | 404 / not-found | Support both as a route and as a loader outcome. |
| 13 | Dynamic params | `[id]` segments parsed and passed to loaders. |

### 9.3 Client layer (P1) — three lines, not a subsystem

| # | Feature | Requirement |
|---|---|---|
| 14 | Adopt the dependency | Alpine is bundled and started by default; `alpine: false` opts out without disabling Brandy navigation. |
| 15 | Document the territory line | State in README: navigation + data = framework; client state = dependency. Stops relitigation. |
| 16 | Reactivity-agnostic seam | (Covered by #6's constraint — listed so it's never treated as new work. It's the load-bearing rule.) |

### 9.4 Differentiators (P2) — ship one at a time, last

| # | Feature | Requirement |
|---|---|---|
| 17 | Streaming `loading` states | Skeleton instantly, stream resolved content into the same slot via streamed responses. Biggest gap-closer vs. Next. |
| 18 | Intercepting routes | Modal-over-list: same URL = modal on soft-nav, standalone page on hard load. The flagship "holy crap" demo. |
| 19 | Parallel routes | Independent outlets with their own URLs; one nav → primary swap + OOB swaps. Hairy; build dead last. |
| 20 | Prefetch on hover | Warm the next fragment before the click. |
| 21 | Dev experience | File-watch so adding a file = a route appears, no manual reboot. |

## 10. Server Actions

Brandy supports server-driven mutations that *feel* like Next Server Actions, with one deliberate difference.

**What it provides (the (a) half — "mutate without hand-writing an endpoint or fetch"):**

```tsx
// app/cart/actions.ts
export async function addToCart(form) {
  await db.cart.add(form.get("id"))
  return revalidate("/cart")   // re-render the affected segment
}
```

```tsx
// the developer writes a plain form — no endpoint, no hx-post, no fetch
<form action={addToCart}><button>Add</button></form>
```

The framework sees the `action` reference, generates the POST route, and wires the form to it. The **form is the wiring**, exactly as the **href is the wiring** for navigation. `revalidate()` reuses navigation machinery: re-run the segment's loader, render it naked, OOB-swap it into its slot. No new subsystem required — this is where Brandy is arguably *cheaper* than Next's `revalidatePath` (which leans on full RSC re-render). Progressive enhancement is free: no JS → native form post → full-nav fallback.

**What it does not provide (the (b) half — "import and call as a typed function"):** there is no typed client RPC stub. The "call" is a form submission; arguments are form fields; the return is HTML. Server-side input typing is handled in the route handler, but the client gets no typed function. This is the same trade accepted by choosing HTML-over-the-wire over RSC (Decision D1) — not a defect.

**Pending / optimistic UI** (Next's `useFormStatus` / `useOptimistic`) is client state → the adopted dependency's job, not Brandy's.

## 11. Key Decisions (Decision Log)

- **D1 — HTML over the wire, not RSC.** Brandy renders strings and swaps fragments; it does not implement a server/client component protocol. Consequence: no typed client RPC; full progressive enhancement.
- **D2 — Adopt client reactivity; never build it.** Client-state interactivity is delegated to a dependency (Alpine or signals), permanently. The framework's navigation runtime stays reactivity-agnostic and communicates with the dependency only through the DOM, via one re-init hook on each swap. This keeps the door open to swapping the dependency later at the cost of exactly one rule — not an abstraction layer.
- **D3 — Alpine by default.** Alpine is the adopted client-state dependency and is bundled and started by default. Applications can set `alpine: false` to retain Brandy navigation without Alpine.
- **D4 — Back/forward is a re-diff, not a snapshot restore.** History is handled by re-diffing against the popped URL because htmx's snapshot cache has no knowledge of the layout hierarchy.
- **D5 — Own the request runtime; keep Bun as the build tool.** Brandy replaced Elysia with a minimal portable router (`BrandyApplication`) so production handlers can target Bun, Cloudflare Workers, and Vercel Functions from one build pipeline. `@elysiajs/html`'s JSX runtime is retained for templating; Eden RPC was never used (see D1).

## 12. Risks & Open Questions

- **Niche size (highest risk).** The "loves Next DX, doesn't want React" user is real but narrow. Validation needed before heavy investment.
- **Cultural headwind.** htmx culture prizes locality-of-behavior (explicit per-element wiring) and may view FS-derived magic as a bug, not a feature. Brandy is betting against that preference.
- **The double-render discipline.** Every template must render correctly both naked (partial) and full-wrapped (cold). Easy to author a template that only works one way; this is a footgun to mitigate with conventions/tooling.
- **Back-button correctness.** History over partial navigation is the sharpest technical edge; getting it wrong produces mysterious bugs.
- **"Files, no plumbing" only holds for navigation/data.** The moment a developer needs client interactivity, attributes (plumbing) reappear via the adopted library — and Brandy itself now ships three per-element escape hatches (`data-brandy-reload`, `data-brandy-no-prefetch`, `data-brandy-no-intercept`). The promise must be scoped honestly in docs.
- **Dependency swap cost (D3).** Keep the seam (D2) clean so opting out of Alpine or adopting another client-state library remains practical as features grow.
- **Caching vs. personalization.** `prerender`/`revalidate` cache whole documents including ancestor layouts, and loaders receive the full `Request`. Until Brandy detects dynamic request usage, a cached route that reads cookies or auth headers serves one user's page to everyone. The target user builds logged-in dashboards, so specifying this boundary precisely is itself a differentiator, not just a bug to fix. **Open — issue #1, the last serious audit item alongside #6; design discussion pending.**
- **Streaming punches a hole in the no-JS guarantee.** Deferred `loading.tsx` content arrives as script-applied swaps; a no-JS cold load shows the skeleton forever. This must become either a documented, scoped exception to principle 4 or a solved problem — not an unstated surprise. **Open — issue #6; the decision (stream real HTML chunks vs. document a scoped JS-required exception) is the next design discussion.**
- **Auth story is partially defined.** Loaders can now redirect via the `redirect()` helper (issue #15, shipped), covering "unauthenticated → /login" per route. A middleware concept for cross-cutting auth remains future work.

## 13. Milestones / Roadmap

- **M0 — The heart.** Diff engine (#2) as a standalone, unit-tested pure function. Nasty cases covered: trailing slashes, index vs. named segments, dynamic params changing mid-chain, root-level navigation. — **Shipped.**
- **M1 — It navigates.** Features 1–6 wired together; a multi-segment app navigates with persistent layouts and a no-JS fallback. — **Shipped.**
- **M2 — It's usable.** Loaders (7), back/forward (8), metadata (9), mutations (10), error boundaries (11), 404 (12), dynamic params (13), dependency adopted (14–15). — **Shipped.**
- **M3 — It's "nailed."** Differentiators (17–21), led by streaming loading states and intercepting-route modals as the flagship demo. — **In progress:** streaming (17), intercepting routes (18), prefetch (20), and dev file-watching (21) have shipped; parallel routes (19) remain (see TODO.md). Hardening the shipped surface against the issues from the 2026-07-02 audit takes priority over new differentiators.

## 14. Brand & Aesthetic

**Name:** Brandy.

**Concept hook:** brandy is a *distillate* — and that is precisely what the framework does to a page. On navigation it distills the full document down to only the segment that actually changed, discarding everything shared. "Distill the page to what diverged" is both the engineering core and the brand metaphor.

**Aesthetic direction:** warm, amber, distillery/spirits — a deliberate counter to Next's sterile black-and-white and Elysia's kawaii. Copper and amber on deep brown/black, glass and reflection, aged-label typography (a confident serif or aged grotesk) paired with a clean monospace for code. Polarizing not by being edgy but by being *unexpectedly warm and analog* in a category that defaults to either corporate-neutral or anime-cute.

**Tagline candidates:**
- "Distilled to what changed."
- "Only the diverged segment. Nothing else."
- "Server-rendered. Distilled. No React."

---

## Appendix — Glossary

- **Layout chain:** the ordered list of layouts from root to the page for a given URL.
- **Swap boundary:** the first point at which two URLs' layout chains diverge; where the fragment is swapped in.
- **Slot / outlet:** a layout's `{children}` position; the framework stamps it with an id.
- **Naked render:** rendering a segment without its ancestor layouts (partial navigation).
- **Full-wrapped render:** rendering a segment inside all ancestor layouts (cold load).
- **The seam:** the reactivity-agnostic boundary between Brandy's nav runtime and the adopted client library.

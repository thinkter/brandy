# Brandy

Brandy is an experimental Bun/Elysia framework with Next.js-style file-system routing and persistent nested layouts, but no React or RSC. It renders HTML on the server and sends only the route-tree fragment that diverged during soft navigation.

## Run the example

```sh
bun install
bun test
bun run dev
```

Open `http://localhost:3000`. Links and forms work as ordinary full-page requests without JavaScript. With JavaScript, Brandy derives the swap target from the current and destination routes. Back and forward navigation re-fetches and re-diffs the popped URL; it does not restore DOM snapshots.

## Commands

Brandy owns the server bootstrap. Applications do not need a `server.ts`:

```json
{
  "scripts": {
    "dev": "brandy dev",
    "build": "brandy build",
    "start": "brandy start"
  }
}
```

- `brandy dev` watches routes, configuration, public files, and styles. Page and nested-layout changes refresh the affected boundary while shared layout state remains mounted.
- `brandy build` writes a deployable server, static route manifest, client runtime, CSS, and public files to `.brandy/`.
- `brandy start` runs that production artifact and reports a missing or stale build instead of falling back to source files.

The defaults are `app/`, `public/`, an optional root `styles.css`, `.brandy/`, and port `3000`. CLI `--host` and `--port` values override `HOST`/`PORT`, which override config and defaults.

An optional `brandy.config.ts` changes conventions or extends the underlying Elysia app without becoming a bootstrap file:

```ts
import { defineConfig } from "brandy/config"

export default defineConfig({
  alpine: true,
  // Optional exact origins allowed to submit server actions in addition to this deployment's origin.
  trustedOrigins: ["https://admin.example.com"],
  setup(app) {
    app.get("/api/health", () => ({ ok: true }))
  },
})
```

Server actions reject POSTs whose `Origin` (or, when absent, `Referer`) does not match the request origin. They also reject requests without either header. `trustedOrigins` is empty by default; add only exact HTTP(S) origins that should be allowed to submit actions.

When `styles.css` exists, Brandy compiles it with Tailwind and injects the stylesheet automatically. Files under `public/` are served from root-relative URLs.

## File conventions

```text
app/
  layout.tsx       # persistent root shell
  page.tsx         # /
  error.tsx        # nearest error boundary
  not-found.tsx    # nearest loader-level 404 boundary
  dashboard/
    actions.ts     # colocated server mutations
    layout.tsx
    page.tsx
    users/
      [id]/
        page.tsx   # /dashboard/users/:id
  404/
    page.tsx       # fallback for unmatched URLs
```

Server JSX is rendered to strings by `@elysiajs/html`; it is never hydrated. Brandy automatically injects its client runtime, so the root layout needs no script setup:

```tsx
import { Html } from "@elysiajs/html"

export default function Layout({ children }: { children: JSX.Element }) {
  return <html><body>{children}</body></html>
}
```

## Loaders, params, and metadata

Each layout and page can export a `load` function. On partial navigation, loaders run in parallel from the route divergence down. `params`, `request`, and `url` are available to loaders and templates.

```tsx
import { Html } from "@elysiajs/html"
import type { Metadata, RenderContext } from "brandy"

export async function load({ params }: { params: Record<string, string> }) {
  return db.users.find(params.id)
}

type Data = Awaited<ReturnType<typeof load>>

export function metadata({ data }: RenderContext<Data>): Metadata {
  return { title: `${data.name} · Users`, meta: { description: data.bio } }
}

export default function Page({ data }: RenderContext<Data>) {
  return <h1>{data.name}</h1>
}
```

Metadata is inserted on cold loads and reconciled out-of-band after partial navigation.

## Actions

Actions live in `actions.ts`. `defineAction` preserves a callable server function while allowing the same reference to render as a generated form URL. Returning `revalidate(path)` runs that route's loader and uses the normal fragment pipeline.

```tsx
// actions.ts
import { defineAction, revalidate } from "brandy"

export const addToCart = defineAction(async (form) => {
  await db.cart.add(form.get("id"))
  return revalidate("/cart")
})

// page.tsx
<form method="post" action={addToCart}><button>Add</button></form>
```

Without JavaScript, successful actions redirect with `303` to the revalidated route.

## Errors and 404s

- `error.tsx` receives `{ error, params, request, url }` and catches loader or render failures at the nearest segment.
- `not-found.tsx` handles `notFound()` outcomes from loaders.
- `app/404/page.tsx` handles unmatched URLs. If omitted, Brandy emits a minimal built-in 404.

## Client state boundary

Navigation and server data are Brandy's responsibility. Client state is Alpine's responsibility. Brandy bundles and starts Alpine by default, so applications can use Alpine attributes directly with no client entrypoint, asset route, or script tag.

```tsx
<div x-data="{ open: false }">
  <button x-on:click="open = !open">Toggle</button>
  <p x-show="open">Client-side state</p>
</div>
```

Use Alpine's long-form directives in TSX. Shorthands such as `@click` and
`:class` are not valid TSX attribute syntax.

TypeScript also cannot parse dots in TSX attribute names. Use a typed spread
when an Alpine modifier is needed:

```tsx
<form {...({ "x-on:submit.prevent": "save()" } satisfies JSX.BrandyAlpineAttributes)}>
  <button>Save</button>
</form>
```

Alpine observes fragment swaps automatically. After each swap, Brandy also calls `window.Brandy.reinit(root)` when provided, preserving the reactivity-agnostic seam for another client library. Set `alpine: false` to keep Brandy navigation without bundling Alpine:

```ts
const app = await createBrandy({ appDir: "./app", alpine: false })
```

```js
window.Brandy = { reinit(root) { /* initialize another client-state library */ } }
```

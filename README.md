# Brandy

Brandy is an experimental Bun/Elysia framework with Next.js-style file-system routing and persistent nested layouts, but no React or RSC. It renders HTML on the server and sends only the route-tree fragment that diverged during soft navigation.

## Run the example

```sh
bun install
bun test
bun run dev
```

Open `http://localhost:3000`. Without JavaScript, links remain ordinary full-page navigations. With JavaScript, Brandy derives the swap target from the current and destination routes.

## App convention

```text
app/
  layout.tsx
  page.tsx
  dashboard/
    layout.tsx
    page.tsx
    settings/
      page.tsx
```

Layouts receive `children`; pages and layouts return server JSX. Brandy's bundled JSX runtime produces HTML strings and does not hydrate. The root layout should load `/_brandy/runtime.js` as a module.

```tsx
import { Html } from "@elysiajs/html"

export default function Layout({ children }: { children: JSX.Element }) {
  return <html><body><nav><a href="/">Home</a></nav>{children}<script type="module" src="/_brandy/runtime.js" /></body></html>
}
```

The runtime exposes one optional reactivity seam. Set `window.Brandy.reinit` to reinitialize whichever client-state library the application adopts after a swap. Brandy shares no state with that library.

```js
window.Brandy = { reinit(root) { /* initialize Alpine, signals, etc. */ } }
```

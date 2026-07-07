import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createMemoryRenderCache, keyFor, PersonalizedRequestError,
  renderFragmentMatchCached, renderFragmentMatchFresh, renderFullMatchCached,
  type LayoutNode, type PageNode, type Route, type RouteDiff, type RouteMatch,
} from "brandy";
import { buildApplication, buildManifest } from "brandy/build";
import { loadConfig } from "../src/tooling.ts";

function syncHtml(rendered: Awaited<ReturnType<typeof renderFullMatchCached>>): string {
  if (rendered.kind !== "sync") throw new Error("expected a synchronous render");
  return rendered.html;
}

test("a revalidate TTL serves cached content until it expires, then recomputes once", async () => {
  let calls = 0;
  const root: LayoutNode = { id: "root", directory: "/app", file: "/app/layout.tsx", render: ({ children }) => `<html>${children}</html>` as JSX.Element };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: () => ++calls,
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
    cache: { revalidateSeconds: 0.05 },
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };
  const cache = createMemoryRenderCache();

  expect(syncHtml(await renderFullMatchCached(match, new Request("http://localhost/"), {}, cache))).toContain("<main>1</main>");
  expect(syncHtml(await renderFullMatchCached(match, new Request("http://localhost/"), {}, cache))).toContain("<main>1</main>");
  expect(calls).toBe(1);

  await Bun.sleep(70);
  expect(syncHtml(await renderFullMatchCached(match, new Request("http://localhost/"), {}, cache))).toContain("<main>2</main>");
  expect(calls).toBe(2);
});

test("prerender = true (no revalidate) caches forever until an action's revalidate() write-through", async () => {
  let calls = 0;
  const root: LayoutNode = { id: "root", directory: "/app", file: "/app/layout.tsx", render: ({ children }) => `<html>${children}</html>` as JSX.Element };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: () => ++calls,
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
    cache: { revalidateSeconds: null },
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };
  const cache = createMemoryRenderCache();

  expect(syncHtml(await renderFullMatchCached(match, new Request("http://localhost/"), {}, cache))).toContain("<main>1</main>");
  expect(syncHtml(await renderFullMatchCached(match, new Request("http://localhost/"), {}, cache))).toContain("<main>1</main>");
  expect(calls).toBe(1);

  const diff: RouteDiff = { current: match, target: match, boundary: root, chainToRender: [root] };
  const revalidated = await renderFragmentMatchFresh(diff, new Request("http://localhost/"), {}, cache);
  expect(syncHtml(revalidated)).toContain("<main>2</main>");
  expect(calls).toBe(2);

  expect(syncHtml(await renderFullMatchCached(match, new Request("http://localhost/"), {}, cache))).toContain("<main>2</main>");
  expect(calls).toBe(2);
});

test("dev mode always bypasses the cache, even for a cache-eligible route", async () => {
  let calls = 0;
  const root: LayoutNode = { id: "root", directory: "/app", file: "/app/layout.tsx", render: ({ children }) => `<html>${children}</html>` as JSX.Element };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: () => ++calls,
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
    cache: { revalidateSeconds: null },
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };
  const cache = createMemoryRenderCache();

  await renderFullMatchCached(match, new Request("http://localhost/"), { dev: true }, cache);
  await renderFullMatchCached(match, new Request("http://localhost/"), { dev: true }, cache);
  expect(calls).toBe(2);
  expect(cache.get(keyFor("/", 1, {}, ""))).toBeUndefined();
});

test("different soft-nav depths for the same route cache separately and never cross-contaminate", async () => {
  const root: LayoutNode = { id: "root", directory: "/app", file: "/app/layout.tsx", render: ({ children }) => `<ROOT>${children}</ROOT>` as JSX.Element };
  const nested: LayoutNode = { id: "nested", directory: "/app/nested", file: "/app/nested/layout.tsx", render: ({ children }) => `<NESTED>${children}</NESTED>` as JSX.Element };
  const page: PageNode = {
    id: "nested/page", directory: "/app/nested", file: "/app/nested/page.tsx",
    render: () => `<main>page</main>` as JSX.Element,
    cache: { revalidateSeconds: null },
  };
  const route: Route = { id: "/nested", pattern: "/nested", segments: ["nested"], layouts: [root, nested], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/nested", params: {} };
  const cache = createMemoryRenderCache();

  const shallow: RouteDiff = { current: match, target: match, boundary: nested, chainToRender: [nested] };
  const deep: RouteDiff = { current: match, target: match, boundary: root, chainToRender: [root, nested] };

  const shallowRendered = syncHtml(await renderFragmentMatchCached(shallow, new Request("http://localhost/nested"), {}, cache));
  const deepRendered = syncHtml(await renderFragmentMatchCached(deep, new Request("http://localhost/nested"), {}, cache));
  expect(shallowRendered).not.toContain("<ROOT>");
  expect(shallowRendered).toContain("<NESTED>");
  expect(deepRendered).toContain("<ROOT>");
  expect(deepRendered).toContain("<NESTED>");

  expect(cache.get(keyFor("/nested", 1, {}, ""))).toBeDefined();
  expect(cache.get(keyFor("/nested", 2, {}, ""))).toBeDefined();
});

test("dynamic params and query strings are isolated into distinct cache entries", async () => {
  const root: LayoutNode = { id: "root", directory: "/app", file: "/app/layout.tsx", render: ({ children }) => `<html>${children}</html>` as JSX.Element };
  const page: PageNode = {
    id: "items/[id]/page", directory: "/app/items/[id]", file: "/app/items/[id]/page.tsx",
    render: ({ params, url }) => `<main>${params.id}:${url.searchParams.get("x") ?? ""}</main>` as JSX.Element,
    cache: { revalidateSeconds: null },
  };
  const route: Route = { id: "/items/[id]", pattern: "/items/[id]", segments: ["items", "[id]"], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const cache = createMemoryRenderCache();

  const matchOne: RouteMatch = { route, pathname: "/items/1", params: { id: "1" } };
  const matchTwo: RouteMatch = { route, pathname: "/items/2", params: { id: "2" } };

  expect(syncHtml(await renderFullMatchCached(matchOne, new Request("http://localhost/items/1"), {}, cache))).toContain("1:");
  expect(syncHtml(await renderFullMatchCached(matchTwo, new Request("http://localhost/items/2"), {}, cache))).toContain("2:");
  expect(syncHtml(await renderFullMatchCached(matchOne, new Request("http://localhost/items/1?x=a"), {}, cache))).toContain("1:a");
  expect(syncHtml(await renderFullMatchCached(matchOne, new Request("http://localhost/items/1?x=b"), {}, cache))).toContain("1:b");

  expect(cache.get(keyFor("/items/[id]", 1, { id: "1" }, ""))).toBeDefined();
  expect(cache.get(keyFor("/items/[id]", 1, { id: "2" }, ""))).toBeDefined();
  expect(cache.get(keyFor("/items/[id]", 1, { id: "1" }, "?x=a"))).toBeDefined();
  expect(cache.get(keyFor("/items/[id]", 1, { id: "1" }, "?x=b"))).toBeDefined();
});

test("the LRU evicts the oldest entry once the max is exceeded", () => {
  const cache = createMemoryRenderCache(2);
  cache.set("a", { html: "A", metadata: {}, expiresAt: null });
  cache.set("b", { html: "B", metadata: {}, expiresAt: null });
  cache.set("c", { html: "C", metadata: {}, expiresAt: null });

  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("b")).toEqual({ html: "B", metadata: {}, expiresAt: null });
  expect(cache.get("c")).toEqual({ html: "C", metadata: {}, expiresAt: null });
});

test("a get() refreshes recency, so a just-read entry survives an eviction that would otherwise remove it", () => {
  const cache = createMemoryRenderCache(2);
  cache.set("a", { html: "A", metadata: {}, expiresAt: null });
  cache.set("b", { html: "B", metadata: {}, expiresAt: null });
  // Touch "a" so it becomes the most-recently-used entry; "b" is now the oldest.
  expect(cache.get("a")).toBeDefined();
  cache.set("c", { html: "C", metadata: {}, expiresAt: null });

  expect(cache.get("b")).toBeUndefined();
  expect(cache.get("a")).toEqual({ html: "A", metadata: {}, expiresAt: null });
  expect(cache.get("c")).toEqual({ html: "C", metadata: {}, expiresAt: null });
});

test("unique query strings churn the cache instead of growing it without bound", async () => {
  const root: LayoutNode = { id: "root", directory: "/app", file: "/app/layout.tsx", render: ({ children }) => `<html>${children}</html>` as JSX.Element };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    render: ({ url }) => `<main>${url.searchParams.get("q") ?? ""}</main>` as JSX.Element,
    cache: { revalidateSeconds: null },
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };
  const maxEntries = 10;
  const cache = createMemoryRenderCache(maxEntries);

  const total = 500;
  for (let index = 0; index < total; index++) {
    await renderFullMatchCached(match, new Request(`http://localhost/?q=${index}`), {}, cache);
  }

  // An attacker requesting unique ?q= values must not be able to grow the cache without bound:
  // only the most recent `maxEntries` distinct queries should remain reachable...
  let survivors = 0;
  for (let index = 0; index < total; index++) {
    if (cache.get(keyFor("/", 1, {}, `?q=${index}`)) !== undefined) survivors++;
  }
  expect(survivors).toBe(maxEntries);
  // ...and specifically the most-recently-written ones, not an arbitrary subset.
  for (let index = total - maxEntries; index < total; index++) {
    expect(cache.get(keyFor("/", 1, {}, `?q=${index}`))).toBeDefined();
  }
});

async function expectBootError(files: Record<string, string>): Promise<void> {
  const root = await mkdtemp(join(process.cwd(), ".brandy-test-cache-"));
  const dir = join(root, "app");
  try {
    await Promise.all(Object.entries(files).map(async ([relativePath, contents]) => {
      const file = join(dir, relativePath);
      await mkdir(join(file, ".."), { recursive: true });
      await writeFile(file, contents);
    }));
    await expect(buildManifest(dir)).rejects.toThrow(/mutually exclusive/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("prerender/revalidate on a page with its own loading.tsx throws at boot", async () => {
  await expectBootError({
    "layout.tsx": `export default function Layout({ children }) { return children; }`,
    "loading.tsx": `export default function Loading() { return "loading"; }`,
    "page.tsx": `export const revalidate = 60; export default function Page() { return "page"; }`,
  });
});

test("prerender/revalidate on a page whose ancestor layout has a loading.tsx throws at boot", async () => {
  await expectBootError({
    "layout.tsx": `export default function Layout({ children }) { return children; }`,
    "loading.tsx": `export default function Loading() { return "loading"; }`,
    "child/page.tsx": `export const prerender = true; export default function Page() { return "page"; }`,
  });
});

function cookieReadingRoute(): { route: Route; match: RouteMatch } {
  const root: LayoutNode = { id: "root", directory: "/app", file: "/app/layout.tsx", render: ({ children }) => `<html>${children}</html>` as JSX.Element };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: ({ request }) => request.headers.get("cookie"),
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
    cache: { revalidateSeconds: null },
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  return { route, match: { route, pathname: "/", params: {} } };
}

test("a prerender = true route whose loader reads request.headers.get(\"cookie\") throws PersonalizedRequestError", async () => {
  const { match } = cookieReadingRoute();
  const request = new Request("http://localhost/", { headers: { cookie: "session=abc" } });
  await expect(renderFullMatchCached(match, request, {}, createMemoryRenderCache())).rejects.toThrow(PersonalizedRequestError);
  await expect(renderFullMatchCached(match, request, {}, createMemoryRenderCache())).rejects.toThrow(/prerender.*revalidate/s);
});

test("the cookie guard still throws in dev mode — violations must be caught before deploy", async () => {
  const { match } = cookieReadingRoute();
  const request = new Request("http://localhost/", { headers: { cookie: "session=abc" } });
  await expect(renderFullMatchCached(match, request, { dev: true }, createMemoryRenderCache())).rejects.toThrow(PersonalizedRequestError);
});

test("the guard also throws for renderFragmentMatchCached and renderFragmentMatchFresh on a cache-eligible route", async () => {
  const { route, match } = cookieReadingRoute();
  const diff: RouteDiff = { current: match, target: match, boundary: route.layouts[0]!, chainToRender: route.layouts };
  const request = new Request("http://localhost/", { headers: { cookie: "session=abc" } });
  await expect(renderFragmentMatchCached(diff, request, {}, createMemoryRenderCache())).rejects.toThrow(PersonalizedRequestError);
  await expect(renderFragmentMatchFresh(diff, request, {}, createMemoryRenderCache())).rejects.toThrow(PersonalizedRequestError);
});

test("full header iteration also throws for a cache-eligible route", async () => {
  const root: LayoutNode = { id: "root", directory: "/app", file: "/app/layout.tsx", render: ({ children }) => `<html>${children}</html>` as JSX.Element };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: ({ request }) => { for (const _ of request.headers) { /* noop */ } return "unreached"; },
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
    cache: { revalidateSeconds: null },
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };
  await expect(renderFullMatchCached(match, new Request("http://localhost/"), {}, createMemoryRenderCache())).rejects.toThrow(PersonalizedRequestError);
});

test("a cached route reading a non-sensitive header still renders and caches normally", async () => {
  const root: LayoutNode = { id: "root", directory: "/app", file: "/app/layout.tsx", render: ({ children }) => `<html>${children}</html>` as JSX.Element };
  let calls = 0;
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: ({ request }) => { calls++; return request.headers.get("accept-language") ?? "none"; },
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
    cache: { revalidateSeconds: null },
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };
  const cache = createMemoryRenderCache();

  const request = new Request("http://localhost/", { headers: { "accept-language": "fr" } });
  expect(syncHtml(await renderFullMatchCached(match, request, {}, cache))).toContain("<main>fr</main>");
  expect(syncHtml(await renderFullMatchCached(match, request, {}, cache))).toContain("<main>fr</main>");
  expect(calls).toBe(1);
  expect(cache.get(keyFor("/", 1, {}, ""))).toBeDefined();
});

test("a non-cached route reading cookies is unaffected by the guard", async () => {
  const root: LayoutNode = { id: "root", directory: "/app", file: "/app/layout.tsx", render: ({ children }) => `<html>${children}</html>` as JSX.Element };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: ({ request }) => request.headers.get("cookie") ?? "anonymous",
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
    // No `cache` — this route is never prerendered/revalidated.
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };
  const request = new Request("http://localhost/", { headers: { cookie: "session=abc" } });

  expect(syncHtml(await renderFullMatchCached(match, request, {}, createMemoryRenderCache()))).toContain("<main>session=abc</main>");
});

test("the build-time prerender warm-up fails the build when a cached route's loader reads cookies", async () => {
  const root = await mkdtemp(join(process.cwd(), ".brandy-test-build-guard-"));
  try {
    await mkdir(join(root, "app"), { recursive: true });
    await writeFile(join(root, "app/layout.tsx"), `
      import { Html } from "@elysiajs/html";
      export default function Layout({ children }) {
        return <html><head></head><body>{children}</body></html>;
      }
    `);
    await writeFile(join(root, "app/page.tsx"), `
      import { Html } from "@elysiajs/html";
      export const prerender = true;
      export function load({ request }) { return request.headers.get("cookie"); }
      export default function Page({ data }) { return <main>{data}</main>; }
    `);
    const config = await loadConfig(root);
    config.styles = false;
    config.adapter = { ...config.adapter, outputDir: join(root, "out") };
    await expect(buildApplication(config)).rejects.toThrow(/reads the "cookie" header/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

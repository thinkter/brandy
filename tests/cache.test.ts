import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createMemoryRenderCache, keyFor,
  renderFragmentMatchCached, renderFragmentMatchFresh, renderFullMatchCached,
  type LayoutNode, type PageNode, type Route, type RouteDiff, type RouteMatch,
} from "brandy";
import { buildManifest } from "brandy/build";

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

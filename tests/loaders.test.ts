import { expect, test } from "bun:test";
import { memoizeLoader, redirect, renderFragmentMatch, renderFullMatch, type LayoutNode, type PageNode, type Route, type RouteMatch, type RouteDiff } from "brandy";

function routeWith(loadLayout: LayoutNode["load"], loadPage: PageNode["load"]): RouteMatch {
  const root: LayoutNode = {
    id: "root", directory: "/app", file: "/app/layout.tsx", load: loadLayout,
    render: ({ children, data }) => `<html><body data-layout="${data}">${children}</body></html>` as JSX.Element,
  };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx", load: loadPage,
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  return { route, pathname: "/", params: {} };
}

test("segment loaders start in parallel", async () => {
  const started: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const root: LayoutNode = {
    id: "root", directory: "/app", file: "/app/layout.tsx",
    load: async () => { started.push("layout"); await gate; return "layout data"; },
    render: ({ children, data }) => `<html><body data-layout="${data}">${children}</body></html>` as JSX.Element,
  };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: async () => { started.push("page"); await gate; return "page data"; },
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };
  const rendering = renderFullMatch(match, new Request("http://localhost/"));
  await Bun.sleep(0);
  expect(started.sort()).toEqual(["layout", "page"]);
  release();
  const result = await rendering;
  expect(result.kind).toBe("sync");
  if (result.kind !== "sync") throw new Error("expected a synchronous render");
  expect(result.html).toContain("layout data");
  expect(result.html).toContain("page data");
});

test("identical work in parallel loaders is memoized for one render", async () => {
  let calls = 0;
  const getValue = memoizeLoader(async (id: string) => {
    calls++;
    await Bun.sleep(1);
    return `value:${id}`;
  });
  const match = routeWith(() => getValue("shared"), () => getValue("shared"));

  const rendered = await renderFullMatch(match, new Request("http://localhost/"));

  expect(calls).toBe(1);
  expect(rendered.kind).toBe("sync");
  if (rendered.kind !== "sync") throw new Error("expected a synchronous render");
  expect(rendered.html).toContain('data-layout="value:shared"');
  expect(rendered.html).toContain("<main>value:shared</main>");
});

test("memoized loader work is isolated by arguments and render", async () => {
  let calls = 0;
  const getValue = memoizeLoader((id: string) => `${id}:${++calls}`);
  const match = routeWith(() => getValue("layout"), () => getValue("page"));

  await Promise.all([
    renderFullMatch(match, new Request("http://localhost/one")),
    renderFullMatch(match, new Request("http://localhost/two")),
  ]);

  expect(calls).toBe(4);
  expect(getValue("outside")).toBe("outside:5");
  expect(getValue("outside")).toBe("outside:6");
});

test("memoized loader failures execute once per render", async () => {
  let calls = 0;
  const fail = memoizeLoader(async (): Promise<never> => {
    calls++;
    await Bun.sleep(1);
    throw new Error("shared failure");
  });
  const match = routeWith(fail, fail);
  match.route.layouts[0]!.renderError = ({ error }) => `<p>${(error as Error).message}</p>` as JSX.Element;

  const rendered = await renderFullMatch(match, new Request("http://localhost/"));

  expect(calls).toBe(1);
  expect(rendered.kind).toBe("sync");
  if (rendered.kind !== "sync") throw new Error("expected a synchronous render");
  expect(rendered.html).toContain("shared failure");
});

test("redirect() in a layout loader produces a redirect result on cold load", async () => {
  const root: LayoutNode = {
    id: "root", directory: "/app", file: "/app/layout.tsx",
    load: () => redirect("/login"),
    render: ({ children }) => `<html><body>${children}</body></html>` as JSX.Element,
  };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    render: () => `<main>dashboard</main>` as JSX.Element,
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };

  const rendered = await renderFullMatch(match, new Request("http://localhost/dashboard"));
  expect(rendered.kind).toBe("redirect");
  if (rendered.kind !== "redirect") throw new Error("expected a redirect result");
  expect(rendered.response.status).toBe(302);
  expect(rendered.response.headers.get("location")).toBe("/login");
});

test("redirect() in a page loader produces a redirect result on cold load", async () => {
  const root: LayoutNode = {
    id: "root", directory: "/app", file: "/app/layout.tsx",
    render: ({ children }) => `<html><body>${children}</body></html>` as JSX.Element,
  };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: () => redirect("/login", 301),
    render: () => `<main>private</main>` as JSX.Element,
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };

  const rendered = await renderFullMatch(match, new Request("http://localhost/private"));
  expect(rendered.kind).toBe("redirect");
  if (rendered.kind !== "redirect") throw new Error("expected a redirect result");
  expect(rendered.response.status).toBe(301);
  expect(rendered.response.headers.get("location")).toBe("/login");
});

test("redirect() in a layout loader produces a redirect result on fragment navigation", async () => {
  const root: LayoutNode = {
    id: "root", directory: "/app", file: "/app/layout.tsx",
    render: ({ children }) => `<html><body>${children}</body></html>` as JSX.Element,
  };
  const dashboard: LayoutNode = {
    id: "dashboard", directory: "/app/dashboard", file: "/app/dashboard/layout.tsx",
    load: () => redirect("/login"),
    render: ({ children }) => `<section>${children}</section>` as JSX.Element,
  };
  const page: PageNode = {
    id: "dashboard/page", directory: "/app/dashboard", file: "/app/dashboard/page.tsx",
    render: () => `<main>dashboard</main>` as JSX.Element,
  };
  const route: Route = { id: "/dashboard", pattern: "/dashboard", segments: ["dashboard"], layouts: [root, dashboard], page, pageFile: page.file, renderPage: page.render };
  const current: RouteMatch = { route: { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render }, pathname: "/", params: {} };
  const target: RouteMatch = { route, pathname: "/dashboard", params: {} };
  const diff: RouteDiff = { current, target, boundary: root, chainToRender: [dashboard] };

  const rendered = await renderFragmentMatch(diff, new Request("http://localhost/dashboard"));
  expect(rendered.kind).toBe("redirect");
  if (rendered.kind !== "redirect") throw new Error("expected a redirect result");
  expect(rendered.response.status).toBe(302);
  expect(rendered.response.headers.get("location")).toBe("/login");
});

test("redirect() bypasses error boundaries", async () => {
  const root: LayoutNode = {
    id: "root", directory: "/app", file: "/app/layout.tsx",
    load: () => redirect("/login"),
    render: ({ children }) => `<html><body>${children}</body></html>` as JSX.Element,
    renderError: () => `<p>error boundary</p>` as JSX.Element,
  };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    render: () => `<main>protected</main>` as JSX.Element,
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };

  const rendered = await renderFullMatch(match, new Request("http://localhost/protected"));
  // redirect must bypass any error boundary — the redirect response should come through
  expect(rendered.kind).toBe("redirect");
  if (rendered.kind !== "redirect") throw new Error("expected a redirect result");
  expect(rendered.response.headers.get("location")).toBe("/login");
});

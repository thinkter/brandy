import { expect, test } from "bun:test";
import { memoizeLoader, renderFullMatch, type LayoutNode, type PageNode, type Route, type RouteMatch } from "brandy";

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

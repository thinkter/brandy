import { expect, test } from "bun:test";
import { renderFullMatch, type LayoutNode, type PageNode, type Route, type RouteMatch } from "brandy";

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
  expect(result.html).toContain("layout data");
  expect(result.html).toContain("page data");
});

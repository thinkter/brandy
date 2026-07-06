import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  memoizeLoader, renderFragmentMatch, renderFullMatch,
  type LayoutNode, type PageNode, type Route, type RouteDiff, type RouteMatch,
} from "brandy";
import { createDevelopmentApp as createBrandy } from "brandy/build";

const appDir = new URL("../example/app", import.meta.url).pathname;

function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

test("the skeleton streams before the loader resolves, real content after", async () => {
  const { promise: loaderGate, release } = gate();
  const root: LayoutNode = {
    id: "root", directory: "/app", file: "/app/layout.tsx",
    render: ({ children }) => `<html><body>${children}</body></html>` as JSX.Element,
  };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: async () => { await loaderGate; return "real data"; },
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
    renderLoading: () => `<main>SKELETON</main>` as JSX.Element,
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };

  const rendered = await renderFullMatch(match, new Request("http://localhost/"));
  expect(rendered.kind).toBe("stream");
  if (rendered.kind !== "stream") throw new Error("expected a streaming render");
  expect(rendered.status).toBe(200);

  const reader = rendered.stream.getReader();
  const decoder = new TextDecoder();
  const first = await reader.read();
  const skeletonChunk = decoder.decode(first.value, { stream: true });
  expect(skeletonChunk).toContain("SKELETON");
  expect(skeletonChunk).not.toContain("real data");
  expect(skeletonChunk).not.toContain("</body>");
  expect(skeletonChunk).not.toContain("</html>");

  release();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) rest += decoder.decode(value, { stream: true });
    if (done) break;
  }
  rest += decoder.decode();
  expect(rest).toContain("real data");
  expect(rest).toContain("</body></html>");
  const document = skeletonChunk + rest;
  expect(document.match(/<\/body>/g)).toHaveLength(1);
  expect(document.match(/<\/html>/g)).toHaveLength(1);
  expect(document.indexOf("real data")).toBeLessThan(document.indexOf("</body>"));
});

test("streaming ancestor and deferred loaders share one memoization scope", async () => {
  let calls = 0;
  const getShared = memoizeLoader(async () => {
    calls++;
    return "shared data";
  });
  const root: LayoutNode = {
    id: "root", directory: "/app", file: "/app/layout.tsx", load: () => getShared(),
    render: ({ children, data }) => `<html><body data-root="${data}">${children}</body></html>` as JSX.Element,
  };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx", load: () => getShared(),
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
    renderLoading: () => `<main>SKELETON</main>` as JSX.Element,
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };

  const rendered = await renderFullMatch(match, new Request("http://localhost/"));
  if (rendered.kind !== "stream") throw new Error("expected a streaming render");
  const html = await new Response(rendered.stream).text();

  expect(calls).toBe(1);
  expect(html).toContain('data-root="shared data"');
  expect(html).toContain("shared data");
});

test("a loader error after the skeleton ships stays status 200 and renders the boundary in-band", async () => {
  const { promise: loaderGate, release } = gate();
  const renderError = ({ error }: { error: unknown }) => `<p>boundary: ${error instanceof Error ? error.message : "?"}</p>` as JSX.Element;
  const root: LayoutNode = {
    id: "root", directory: "/app", file: "/app/layout.tsx",
    render: ({ children }) => `<html><body>${children}</body></html>` as JSX.Element,
  };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: async () => { await loaderGate; throw new Error("boom"); },
    render: ({ data }) => `<main>${data}</main>` as JSX.Element,
    renderLoading: () => `<main>SKELETON</main>` as JSX.Element,
    renderError,
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };

  const rendered = await renderFullMatch(match, new Request("http://localhost/"));
  if (rendered.kind !== "stream") throw new Error("expected a streaming render");
  expect(rendered.status).toBe(200);
  const reader = rendered.stream.getReader();
  const decoder = new TextDecoder();
  const first = await reader.read();
  const skeletonChunk = decoder.decode(first.value, { stream: true });
  expect(skeletonChunk).toContain("SKELETON");
  expect(skeletonChunk).not.toContain("</body>");
  release();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) rest += decoder.decode(value, { stream: true });
    if (done) break;
  }
  rest += decoder.decode();
  expect(rest).toContain("boundary: boom");
  expect(rest).toContain("<title data-brandy-metadata>Error");
  expect(rest).toContain("</body></html>");
});

test("a streamed document replaces provisional ancestor metadata with the final merged metadata", async () => {
  const { promise: loaderGate, release } = gate();
  const root: LayoutNode = {
    id: "root", directory: "/app", file: "/app/layout.tsx",
    metadata: { title: "Loading title", meta: { description: "Root description" } },
    render: ({ children }) => `<html><head></head><body>${children}</body></html>` as JSX.Element,
  };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: async () => { await loaderGate; return { title: "Resolved title" }; },
    metadata: ({ data }) => ({ title: (data as { title: string }).title }),
    render: ({ data }) => `<main>${(data as { title: string }).title}</main>` as JSX.Element,
    renderLoading: () => `<main>SKELETON</main>` as JSX.Element,
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };

  const rendered = await renderFullMatch(match, new Request("http://localhost/"));
  if (rendered.kind !== "stream") throw new Error("expected a streaming render");
  const reader = rendered.stream.getReader();
  const decoder = new TextDecoder();
  const first = await reader.read();
  const skeletonChunk = decoder.decode(first.value, { stream: true });
  expect(skeletonChunk).toContain("Loading title");
  expect(skeletonChunk).toContain("Root description");

  release();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) rest += decoder.decode(value, { stream: true });
    if (done) break;
  }
  rest += decoder.decode();
  expect(rest).toContain('document.querySelectorAll("[data-brandy-metadata]")');
  expect(rest).toContain("Resolved title");
  expect(rest).toContain("Root description");
});

test("metadata is deferred to the final chunk of a streamed fragment", async () => {
  const { promise: loaderGate, release } = gate();
  const root: LayoutNode = {
    id: "root", directory: "/app", file: "/app/layout.tsx",
    render: ({ children }) => `<html><body>${children}</body></html>` as JSX.Element,
  };
  const page: PageNode = {
    id: "root/page", directory: "/app", file: "/app/page.tsx",
    load: async () => { await loaderGate; return { title: "Resolved title" }; },
    metadata: ({ data }) => ({ title: (data as { title: string }).title }),
    render: ({ data }) => `<main>${(data as { title: string }).title}</main>` as JSX.Element,
    renderLoading: () => `<main>SKELETON</main>` as JSX.Element,
  };
  const route: Route = { id: "/", pattern: "/", segments: [], layouts: [root], page, pageFile: page.file, renderPage: page.render };
  const match: RouteMatch = { route, pathname: "/", params: {} };
  const diff: RouteDiff = { current: match, target: match, boundary: root, chainToRender: [] };

  const rendered = await renderFragmentMatch(diff, new Request("http://localhost/"));
  if (rendered.kind !== "stream") throw new Error("expected a streaming render");
  const reader = rendered.stream.getReader();
  const decoder = new TextDecoder();
  const first = await reader.read();
  expect(decoder.decode(first.value, { stream: true })).not.toContain("data-brandy-head");

  release();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) rest += decoder.decode(value, { stream: true });
    if (done) break;
  }
  rest += decoder.decode();
  expect(rest).toContain("data-brandy-head");
  expect(rest).toContain("Resolved title");
});

test("streamed fragment metadata includes shared, ancestor, and deferred segments", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/analytics", { headers: {
    "x-brandy-navigation": "1",
    "x-brandy-current-url": "/about",
  }}));
  const html = await response.text();
  expect(html).toContain("Analytics · Brandy");
  expect(html).toContain("Brandy P1 example");
  expect(html).toContain('name="section"');
  expect(html).toContain('content="dashboard"');
});

test("a route without loading.tsx is rendered synchronously, unchanged", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/settings"));
  expect(response.headers.get("x-brandy-stream")).toBeNull();
  expect(response.status).toBe(200);
});

test("cold-load streaming flushes the skeleton fast, injects assets into the first chunk, and degrades safely without JS", async () => {
  // Placed under the project root (not os.tmpdir()) so generated TSX can resolve
  // @elysiajs/html via Bun's node_modules directory walk.
  const root = await mkdtemp(join(process.cwd(), ".brandy-test-streaming-"));
  const dir = join(root, "app");
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(join(dir, "layout.tsx"), `
      import { Html } from "@elysiajs/html";
      export default function Layout({ children }) {
        return <html><body>{children}</body></html>;
      }
    `),
    writeFile(join(dir, "loading.tsx"), `
      import { Html } from "@elysiajs/html";
      export default function Loading() {
        return <main>SKELETON-MARKER</main>;
      }
    `),
    writeFile(join(dir, "page.tsx"), `
      import { Html } from "@elysiajs/html";
      export async function load() {
        await Bun.sleep(30);
        return { value: "REAL-MARKER" };
      }
      export default function Page({ data }) {
        return <main>{data.value}</main>;
      }
    `),
  ]);

  try {
    const app = await createBrandy({ appDir: dir, stylesheet: "body{color:red}", dev: true });
    const response = await app.handle(new Request("http://localhost/"));
    expect(response.headers.get("x-brandy-stream")).toBe("1");
    expect(response.status).toBe(200);
    expect(response.body).not.toBeNull();

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    const firstChunk = decoder.decode(first.value, { stream: true });
    // Static assets (runtime script) are injected into the skeleton chunk synchronously —
    // they don't depend on the loader, so they must not wait for the rest of the stream.
    expect(firstChunk).toContain("/_brandy/runtime.js");
    expect(firstChunk).toContain("/_brandy/app.css");
    expect(firstChunk).toContain("[x-cloak]{display:none!important}");
    expect(firstChunk).toContain("/_brandy/dev.js");
    expect(firstChunk).toContain("SKELETON-MARKER");
    expect(firstChunk).not.toContain("REAL-MARKER");
    expect(firstChunk).not.toContain("</body>");
    expect(firstChunk).not.toContain("</html>");

    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (value) rest += decoder.decode(value, { stream: true });
      if (done) break;
    }
    rest += decoder.decode();
    expect(rest).toContain("REAL-MARKER");
    expect(rest).toContain("</body></html>");
    const document = firstChunk + rest;
    expect(document.match(/<\/body>/g)).toHaveLength(1);
    expect(document.match(/<\/html>/g)).toHaveLength(1);
    expect(document.indexOf("REAL-MARKER")).toBeLessThan(document.indexOf("</body>"));

    // No-JS degradation: if the trailing inline script never executes, the page that was
    // actually delivered to the browser still contains the skeleton's placeholder text
    // (not a broken or empty document) — this is the accepted tradeoff for streaming routes.
    expect(firstChunk + rest).toContain("SKELETON-MARKER");

    const production = await createBrandy({
      appDir: dir,
      runtime: "console.log('runtime')",
      clientPath: "/_brandy/runtime.abcdef123456.js",
      stylesheet: "body{color:red}",
      stylesheetPath: "/_brandy/app.123456abcdef.css",
    });
    const productionResponse = await production.handle(new Request("http://localhost/"));
    const productionReader = productionResponse.body!.getReader();
    const productionFirst = await productionReader.read();
    const productionFirstChunk = decoder.decode(productionFirst.value, { stream: true });
    await productionReader.cancel();
    expect(productionFirstChunk).toContain("/_brandy/runtime.abcdef123456.js");
    expect(productionFirstChunk).toContain("/_brandy/app.123456abcdef.css");
    expect(productionFirstChunk).not.toContain("/_brandy/dev.js");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compiled client runtime understands the streaming wire format", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/_brandy/runtime.js"));
  const source = await response.text();
  expect(source).toContain("x-brandy-stream");
  expect(source).toContain("brandy:stream-boundary");
  expect(source).toContain("data-brandy-stream-target");
  expect(source).toContain("brandyStreamTarget");
});

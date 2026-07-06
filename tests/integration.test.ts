import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrandy as createRuntime, revalidate, type ServerAction } from "brandy";
import { buildManifest, createDevelopmentApp as createBrandy } from "brandy/build";

const appDir = new URL("../example/app", import.meta.url).pathname;

test("cold navigation renders the complete nested document", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/settings"));
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain("<html");
  expect(html).toContain('id="brandy-slot-root"');
  expect(html).toContain('id="brandy-slot-dashboard"');
  expect(html).toContain("Settings");
  expect(html.match(/src="\/_brandy\/runtime\.js"/g)).toHaveLength(1);
});

test("portable setup routes run before Brandy's page fallback", async () => {
  const manifest = await buildManifest(appDir);
  const app = await createRuntime({ manifest, setup(router) {
    router.get("/api/health", () => ({ ok: true }));
  } });
  const response = await app.handle(new Request("http://localhost/api/health"));
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(await response.json()).toEqual({ ok: true });
});

test("trailing slashes redirect to the canonical path before route matching", async () => {
  const manifest = await buildManifest(appDir);
  let postCalls = 0;
  const app = await createRuntime({ manifest, setup(router) {
    router.post("/api/submit/", () => {
      postCalls++;
      return "submitted";
    });
  } });

  const page = await app.handle(new Request("http://localhost/about/?tab=team"));
  expect(page.status).toBe(308);
  expect(page.headers.get("location")).toBe("http://localhost/about?tab=team");

  const post = await app.handle(new Request("http://localhost/api/submit/?draft=1", {
    method: "POST",
    body: "payload",
  }));
  expect(post.status).toBe(308);
  expect(post.headers.get("location")).toBe("http://localhost/api/submit?draft=1");
  expect(postCalls).toBe(0);

  const canonicalPost = await app.handle(new Request("http://localhost/api/submit?draft=1", {
    method: "POST",
    body: "payload",
  }));
  expect(canonicalPost.status).toBe(200);
  expect(await canonicalPost.text()).toBe("submitted");
  expect(postCalls).toBe(1);

  const root = await app.handle(new Request("http://localhost/?tab=home"));
  expect(root.status).toBe(200);
});

test("immutable deployments reject action-driven prerender mutation", async () => {
  const manifest = await buildManifest(appDir);
  manifest.routes.find((route) => route.pattern === "/")!.page.cache = { revalidateSeconds: null };
  const path = "/_brandy/actions/test/revalidate";
  const handler = (async () => revalidate("/")) as unknown as ServerAction;
  manifest.actions.set(path, { id: "test", path, segmentPath: "", file: "test", name: "test", handler });
  const app = await createRuntime({ manifest, immutablePrerender: true });
  const response = await app.handle(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/x-www-form-urlencoded" },
    body: "value=1",
  }));
  expect(response.status).toBe(409);
  expect(await response.text()).toContain("Cannot revalidate an immutable prerendered route");
});

test("framework assets are injected without an application server bootstrap", async () => {
  const app = await createBrandy({ appDir, stylesheet: "body{color:red}", dev: true });
  const html = await (await app.handle(new Request("http://localhost/"))).text();
  expect(html).toContain('href="/_brandy/app.css"');
  expect(html).toContain('src="/_brandy/dev.js"');
  const runtime = await app.handle(new Request("http://localhost/_brandy/runtime.js"));
  expect(runtime.headers.get("cache-control")).toBe("no-cache");
  const css = await app.handle(new Request("http://localhost/_brandy/app.css"));
  expect(await css.text()).toBe("body{color:red}");
  expect(css.headers.get("cache-control")).toBe("no-cache");
});

test("fingerprinted production framework assets use immutable caching", async () => {
  const app = await createBrandy({
    appDir,
    runtime: "console.log('runtime')",
    clientPath: "/_brandy/runtime.abcdef123456.js",
    stylesheet: "body{color:red}",
    stylesheetPath: "/_brandy/app.123456abcdef.css",
  });
  const html = await (await app.handle(new Request("http://localhost/"))).text();
  expect(html.match(/src="\/_brandy\/runtime\.abcdef123456\.js"/g)).toHaveLength(1);
  expect(html.match(/href="\/_brandy\/app\.123456abcdef\.css"/g)).toHaveLength(1);

  const runtime = await app.handle(new Request("http://localhost/_brandy/runtime.abcdef123456.js"));
  expect(await runtime.text()).toBe("console.log('runtime')");
  expect(runtime.headers.get("content-type")).toContain("text/javascript");
  expect(runtime.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

  const css = await app.handle(new Request("http://localhost/_brandy/app.123456abcdef.css"));
  expect(await css.text()).toBe("body{color:red}");
  expect(css.headers.get("content-type")).toContain("text/css");
  expect(css.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
});

test("public assets stay contained within publicDir", async () => {
  const root = await mkdtemp(join(tmpdir(), "brandy-public-"));
  const publicDir = join(root, "public");
  await mkdir(join(publicDir, "nested"), { recursive: true });
  await Promise.all([
    Bun.write(join(publicDir, "nested", "asset.txt"), "public asset"),
    Bun.write(join(publicDir, "asset..txt"), "safe dotted asset"),
    Bun.write(join(root, "secret.txt"), "private sibling file"),
  ]);

  try {
    const app = await createBrandy({ appDir, publicDir });
    const nested = await app.handle(new Request("http://localhost/nested/asset.txt"));
    expect(nested.status).toBe(200);
    expect(await nested.text()).toBe("public asset");

    const dotted = await app.handle(new Request("http://localhost/asset..txt"));
    expect(dotted.status).toBe(200);
    expect(await dotted.text()).toBe("safe dotted asset");

    const traversal = await app.handle(new Request("http://localhost/%2e%2e%2fsecret.txt"));
    expect(traversal.status).toBe(404);
    expect(await traversal.text()).not.toContain("private sibling file");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("development refresh can replace a nested layout boundary", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/settings", { headers: {
    "x-brandy-navigation": "1",
    "x-brandy-current-url": "/dashboard/settings",
    "x-brandy-refresh-boundary": "dashboard",
  }}));
  expect(response.headers.get("x-brandy-retarget")).toBe("#brandy-slot-root");
  const html = await response.text();
  expect(html).toContain('id="brandy-slot-dashboard"');
  expect(html).toContain("Settings");
});

test("partial navigation couples fragment and target headers", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/settings", { headers: {
    "x-brandy-navigation": "1",
    "x-brandy-current-url": "/about",
  }}));
  const html = await response.text();
  expect(response.headers.get("x-brandy-retarget")).toBe("#brandy-slot-root");
  expect(response.headers.get("x-brandy-reswap")).toBe("innerHTML");
  expect(html).not.toContain("<html");
  expect(html).toContain('id="brandy-slot-dashboard"');
  expect(html).toContain("Settings");
  expect(html).not.toContain('/_brandy/runtime.js');
});

test("client runtime is compiled browser JavaScript, and never bundles Alpine", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/_brandy/runtime.js"));
  expect(response.headers.get("content-type")).toContain("text/javascript");
  const source = await response.text();
  expect(source).toContain("x-brandy-navigation");
  expect(source).not.toContain("declare global");
  expect(source).toContain("popstate");
  expect(source).not.toContain("Alpine Expression Error");
});

test("the Alpine chunk is served lazily and only when alpine is enabled", async () => {
  const enabled = await createBrandy({ appDir });
  const enabledResponse = await enabled.handle(new Request("http://localhost/_brandy/alpine.js"));
  expect(enabledResponse.status).toBe(200);
  expect(enabledResponse.headers.get("content-type")).toContain("text/javascript");
  expect(await enabledResponse.text()).toContain("Alpine Expression Error");

  const disabled = await createBrandy({ appDir, alpine: false });
  const disabledResponse = await disabled.handle(new Request("http://localhost/_brandy/alpine.js"));
  expect(disabledResponse.status).toBe(404);
});

test("Alpine can be disabled without disabling Brandy navigation", async () => {
  const app = await createBrandy({ appDir, alpine: false });
  const response = await app.handle(new Request("http://localhost/_brandy/runtime.js"));
  const source = await response.text();
  expect(source).toContain("x-brandy-navigation");
  expect(source).not.toContain("Alpine Expression Error");
});

test("the example uses Alpine islands without a custom client entrypoint", async () => {
  const app = await createBrandy({ appDir });
  const html = await (await app.handle(new Request("http://localhost/"))).text();
  expect(html).toContain("data-brandy-island");
  expect(html).toContain('x-data="{ count: 0, open: true }"');
  expect(html).toContain('x-on:click="count++"');
});

test("Island renders an explicit data-brandy-island boundary", async () => {
  const { Island } = await import("brandy");
  const html = String(Island({ children: "<span>hi</span>" as unknown as JSX.Element }));
  expect(html).toBe("<div data-brandy-island><span>hi</span></div>");

  const section = String(Island({ tag: "section", children: "<span>hi</span>" as unknown as JSX.Element }));
  expect(section).toBe("<section data-brandy-island><span>hi</span></section>");
  expect(html).toContain("<span>hi</span>");
});

test("Alpine cloak CSS is automatic and scoped to Alpine-enabled applications", async () => {
  const enabled = await createBrandy({ appDir });
  const enabledHtml = await (await enabled.handle(new Request("http://localhost/"))).text();
  expect(enabledHtml.match(/<style data-brandy-cloak>/g)).toHaveLength(1);
  expect(enabledHtml).toContain("[x-cloak]{display:none!important}");

  const disabled = await createBrandy({ appDir, alpine: false });
  const disabledHtml = await (await disabled.handle(new Request("http://localhost/"))).text();
  expect(disabledHtml).not.toContain("data-brandy-cloak");
});

test("development cache busting preserves server action URLs", async () => {
  const app = await createBrandy({ appDir, cacheBust: crypto.randomUUID() });
  const html = await (await app.handle(new Request("http://localhost/dashboard"))).text();
  const action = html.match(/<form[^>]+action="([^"]+)"/)?.[1];
  expect(action).toStartWith("/_brandy/actions/");
  expect(action).not.toContain("function");
});

test("server-only loaders can use filesystem and process APIs", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/server"));
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain(`Bun ${Bun.version}`);
  expect(html).toContain("node:fs/promises");
  expect(html).toContain("Functions that never reach the browser");
});

test("shared server components compose into route output", async () => {
  const app = await createBrandy({ appDir });
  const html = await (await app.handle(new Request("http://localhost/components"))).text();
  expect(html).toContain("Reusable server-rendered TSX");
  expect(html).toContain("Server component");
  expect(html).toContain("x-on:click");
});

test("dynamic params feed loaders and loader metadata", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/users/42"));
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain("User 42");
  expect(html).toContain("<title data-brandy-metadata>User 42 · Brandy</title>");
});

test("partial metadata is emitted out of band", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/about", { headers: {
    "x-brandy-navigation": "1",
    "x-brandy-current-url": "/",
  }}));
  const html = await response.text();
  expect(html).toContain("<template data-brandy-head>");
  expect(html).toContain("About · Brandy");
  expect(html).toContain("Brandy P1 example");
});

test("loader notFound uses the nearest not-found boundary", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/users/missing"));
  expect(response.status).toBe(404);
  expect(await response.text()).toContain("The requested page does not exist");
});

test("production error boundaries hide loader details on full and partial navigation", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/users/error"));
  expect(response.status).toBe(500);
  const html = await response.text();
  expect(html).toContain("Dashboard error");
  expect(html).toContain("Something went wrong.");
  expect(html).not.toContain("User loader failed");

  const partial = await app.handle(new Request("http://localhost/dashboard/users/error", { headers: {
    "x-brandy-navigation": "1",
    "x-brandy-current-url": "/about",
  }}));
  expect(partial.status).toBe(500);
  const fragment = await partial.text();
  expect(fragment).toContain("Something went wrong.");
  expect(fragment).not.toContain("User loader failed");
});

test("development error boundaries can render loader details", async () => {
  const app = await createBrandy({ appDir, dev: true });
  const response = await app.handle(new Request("http://localhost/dashboard/users/error"));
  expect(response.status).toBe(500);
  expect(await response.text()).toContain("User loader failed");
});

test("unknown URLs render the explicit 404 route", async () => {
  const manifest = await buildManifest(appDir);
  const app = await createRuntime({ manifest });
  const cachedRoute = manifest.notFoundRoute;
  const response = await app.handle(new Request("http://localhost/does-not-exist"));
  expect(response.status).toBe(404);
  expect(await response.text()).toContain("explicit 404 route");
  await app.handle(new Request("http://localhost/still-does-not-exist"));
  expect(manifest.notFoundRoute).toBe(cachedRoute);
  expect(cachedRoute).toBe(manifest.routes.find((route) => route.pattern === "/404"));
});

test("colocated actions mutate and revalidate a fragment", async () => {
  const app = await createBrandy({ appDir });
  const before = await (await app.handle(new Request("http://localhost/dashboard"))).text();
  const count = Number(before.match(/Count: (\d+)/)?.[1]);
  const action = before.match(/<form[^>]+action="([^"]+)"/)?.[1];
  expect(action).toStartWith("/_brandy/actions/");
  const response = await app.handle(new Request(`http://localhost${action}`, {
    method: "POST",
    headers: { origin: "http://localhost", "x-brandy-navigation": "1", "x-brandy-current-url": "/dashboard" },
    body: new FormData(),
  }));
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get("x-brandy-retarget")).toBe("#brandy-slot-dashboard");
  expect(html).toContain(`Count: ${count + 1}`);
});

test("no-JS actions use a 303 full-navigation fallback", async () => {
  const app = await createBrandy({ appDir });
  const page = await (await app.handle(new Request("http://localhost/dashboard"))).text();
  const action = page.match(/<form[^>]+action="([^"]+)"/)?.[1];
  const response = await app.handle(new Request(`http://localhost${action}`, {
    method: "POST", headers: { referer: "http://localhost/dashboard" }, body: new FormData(),
  }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("http://localhost/dashboard");
});

test("actions reject untrusted or unverifiable request origins", async () => {
  const app = await createBrandy({ appDir });
  const before = await (await app.handle(new Request("http://localhost/dashboard"))).text();
  const count = Number(before.match(/Count: (\d+)/)?.[1]);
  const action = before.match(/<form[^>]+action="([^"]+)"/)?.[1];
  const headers: Array<Record<string, string>> = [
    {},
    { origin: "https://evil.example" },
    { origin: "https://localhost" },
    { origin: "http://localhost:3000" },
    { origin: "http://sub.localhost" },
    { origin: "null" },
    { origin: "not a URL", referer: "http://localhost/dashboard" },
    { referer: "not a URL" },
  ];
  for (const sourceHeaders of headers) {
    const response = await app.handle(new Request(`http://localhost${action}`, {
      method: "POST", headers: sourceHeaders, body: new FormData(),
    }));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Forbidden");
  }
  const after = await (await app.handle(new Request("http://localhost/dashboard"))).text();
  expect(after).toContain(`Count: ${count}`);
});

test("trusted origins can submit actions", async () => {
  const app = await createBrandy({ appDir, trustedOrigins: ["https://admin.example.com/"] });
  const page = await (await app.handle(new Request("http://localhost/dashboard"))).text();
  const action = page.match(/<form[^>]+action="([^"]+)"/)?.[1];
  const response = await app.handle(new Request(`http://localhost${action}`, {
    method: "POST", headers: { origin: "https://admin.example.com" }, body: new FormData(),
  }));
  expect(response.status).toBe(303);
});

test("trusted origins must be absolute HTTP(S) origins", async () => {
  await expect(createBrandy({ appDir, trustedOrigins: ["https://example.com/path"] })).rejects.toThrow("Invalid trusted origin");
  await expect(createBrandy({ appDir, trustedOrigins: ["ftp://example.com"] })).rejects.toThrow("Invalid trusted origin");
});

test("cold-load full-document responses carry Vary on both brandy navigation headers", async () => {
  // A CDN must not serve a cached full document to a fragment request.  Emitting
  // Vary: x-brandy-navigation, x-brandy-current-url on the full-document path
  // ensures the cache key differs between cold-load and fragment requests.
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/settings"));
  expect(response.headers.get("vary")).toContain("x-brandy-navigation");
  expect(response.headers.get("vary")).toContain("x-brandy-current-url");
});

test("action params come from the server-side action route, not from the client-supplied header", async () => {
  const manifest = await buildManifest(appDir);
  let capturedParams: Record<string, string> | undefined;
  const path = "/_brandy/actions/test/params-check";
  const handler = (async (_form, context) => {
    capturedParams = context.params;
  }) as unknown as ServerAction;
  manifest.actions.set(path, { id: "test", path, segmentPath: "dashboard/users/[id]", file: "test", name: "test", handler });

  const app = await createRuntime({ manifest });

  // A client spoofing x-brandy-current-url=/dashboard/users/42 should NOT produce params.id="42"
  await app.handle(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "x-brandy-current-url": "/dashboard/users/42",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "",
  }));
  expect(capturedParams).toEqual({});
});

test("action url is the actual request URL and preserves the query string", async () => {
  const manifest = await buildManifest(appDir);
  let capturedUrl: URL | undefined;
  const path = "/_brandy/actions/test/url-check";
  const handler = (async (_form, context) => {
    capturedUrl = context.url;
  }) as unknown as ServerAction;
  manifest.actions.set(path, { id: "test", path, segmentPath: "", file: "test", name: "test", handler });

  const app = await createRuntime({ manifest });

  // Submit to the action with a query string on the action URL
  await app.handle(new Request(`http://localhost${path}?ref=newsletter`, {
    method: "POST",
    headers: {
      origin: "http://localhost",
      // Even if the current-url header has a different query string, the action url should be the actual request url
      "x-brandy-current-url": "/dashboard?tab=users",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "",
  }));
  expect(capturedUrl?.pathname).toBe(path);
  expect(capturedUrl?.searchParams.get("ref")).toBe("newsletter");
  expect(capturedUrl?.href).toBe(`http://localhost${path}?ref=newsletter`);
});

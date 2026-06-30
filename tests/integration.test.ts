import { expect, test } from "bun:test";
import { createBrandy } from "brandy";

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

test("framework assets are injected without an application server bootstrap", async () => {
  const app = await createBrandy({ appDir, stylesheet: "body{color:red}", dev: true });
  const html = await (await app.handle(new Request("http://localhost/"))).text();
  expect(html).toContain('href="/_brandy/app.css"');
  expect(html).toContain('src="/_brandy/dev.js"');
  const css = await app.handle(new Request("http://localhost/_brandy/app.css"));
  expect(await css.text()).toBe("body{color:red}");
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

test("client runtime is compiled browser JavaScript", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/_brandy/runtime.js"));
  expect(response.headers.get("content-type")).toContain("text/javascript");
  const source = await response.text();
  expect(source).toContain("x-brandy-navigation");
  expect(source).not.toContain("declare global");
  expect(source).toContain("popstate");
  expect(source).toContain("Alpine Expression Error");
});

test("Alpine can be disabled without disabling Brandy navigation", async () => {
  const app = await createBrandy({ appDir, alpine: false });
  const response = await app.handle(new Request("http://localhost/_brandy/runtime.js"));
  const source = await response.text();
  expect(source).toContain("x-brandy-navigation");
  expect(source).not.toContain("Alpine Expression Error");
});

test("the example uses Alpine without a custom client entrypoint", async () => {
  const app = await createBrandy({ appDir });
  const html = await (await app.handle(new Request("http://localhost/"))).text();
  expect(html).toContain('x-data="{ count: 0, open: true }"');
  expect(html).toContain('x-on:click="count++"');
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

test("loader failures use the nearest error boundary", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/users/error"));
  expect(response.status).toBe(500);
  const html = await response.text();
  expect(html).toContain("Dashboard error");
  expect(html).toContain("User loader failed");
});

test("unknown URLs render the explicit 404 route", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/does-not-exist"));
  expect(response.status).toBe(404);
  expect(await response.text()).toContain("explicit 404 route");
});

test("colocated actions mutate and revalidate a fragment", async () => {
  const app = await createBrandy({ appDir });
  const before = await (await app.handle(new Request("http://localhost/dashboard"))).text();
  const count = Number(before.match(/Count: (\d+)/)?.[1]);
  const action = before.match(/<form[^>]+action="([^"]+)"/)?.[1];
  expect(action).toStartWith("/_brandy/actions/");
  const response = await app.handle(new Request(`http://localhost${action}`, {
    method: "POST",
    headers: { "x-brandy-navigation": "1", "x-brandy-current-url": "/dashboard" },
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
  const response = await app.handle(new Request(`http://localhost${action}`, { method: "POST", body: new FormData() }));
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("http://localhost/dashboard");
});

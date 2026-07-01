import { expect, test } from "bun:test";
import { diffRoutes } from "brandy";
import { buildManifest, createDevelopmentApp as createBrandy } from "brandy/build";

const appDir = new URL("../example/app", import.meta.url).pathname;

test("prefetch header does not change fragment output for routes that ignore it", async () => {
  const app = await createBrandy({ appDir });
  const headers = { "x-brandy-navigation": "1", "x-brandy-current-url": "/" };
  const live = await app.handle(new Request("http://localhost/about", { headers }));
  const prefetched = await app.handle(new Request("http://localhost/about", {
    headers: { ...headers, "x-brandy-prefetch": "1" },
  }));
  expect(prefetched.status).toBe(live.status);
  expect(prefetched.headers.get("x-brandy-retarget")).toBe(live.headers.get("x-brandy-retarget"));
  expect(prefetched.headers.get("x-brandy-reswap")).toBe(live.headers.get("x-brandy-reswap"));
  expect(await prefetched.text()).toBe(await live.text());
});

test("a loader can read and round-trip the prefetch header", async () => {
  const app = await createBrandy({ appDir });
  const headers = { "x-brandy-navigation": "1", "x-brandy-current-url": "/dashboard" };
  const live = await app.handle(new Request("http://localhost/dashboard/settings", { headers }));
  expect(await live.text()).toContain("live navigation");

  const prefetched = await app.handle(new Request("http://localhost/dashboard/settings", {
    headers: { ...headers, "x-brandy-prefetch": "1" },
  }));
  expect(await prefetched.text()).toContain("prefetch request");
});

test("the same target URL diffs to different boundaries depending on the current URL", async () => {
  const manifest = await buildManifest(appDir);
  const fromHome = diffRoutes(manifest, "/", "/dashboard/settings");
  const fromDashboard = diffRoutes(manifest, "/dashboard", "/dashboard/settings");
  expect(fromHome.boundary.id).not.toBe(fromDashboard.boundary.id);
  expect(fromHome.chainToRender.length).not.toBe(fromDashboard.chainToRender.length);
});

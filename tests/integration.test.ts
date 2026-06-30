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
});

test("client runtime is compiled browser JavaScript", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/_brandy/runtime.js"));
  expect(response.headers.get("content-type")).toContain("text/javascript");
  const source = await response.text();
  expect(source).toContain("x-brandy-navigation");
  expect(source).not.toContain("declare global");
});

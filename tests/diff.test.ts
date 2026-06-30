import { describe, expect, test } from "bun:test";
import { Html } from "@elysiajs/html";
import { diffRoutes, normalizePathname, slotId, type LayoutNode, type Route, type RouteManifest } from "brandy";

const renderLayout = ({ children }: { children: JSX.Element }) => children;
const root: LayoutNode = { id: "root", file: "app/layout.tsx", render: renderLayout };
const dashboard: LayoutNode = { id: "dashboard", file: "app/dashboard/layout.tsx", render: renderLayout };
const users: LayoutNode = { id: "dashboard/users", file: "app/dashboard/users/layout.tsx", render: renderLayout };

function route(pattern: string, layouts: LayoutNode[]): Route {
  const segments = pattern === "/" ? [] : pattern.slice(1).split("/");
  return { id: pattern, pattern, segments, layouts, pageFile: `${pattern}/page.tsx`, renderPage: () => pattern };
}

const manifest: RouteManifest = {
  appDir: "/app",
  routes: [
    route("/", [root]),
    route("/about", [root]),
    route("/dashboard", [root, dashboard]),
    route("/dashboard/settings", [root, dashboard]),
    route("/dashboard/users/new", [root, dashboard, users]),
    route("/dashboard/users/[id]", [root, dashboard, users]),
  ],
};

describe("normalizePathname", () => {
  test.each([["/", "/"], ["/dashboard/", "/dashboard"], ["https://site.test/about?x=1", "/about"]])("%s", (input, expected) => {
    expect(normalizePathname(input)).toBe(expected);
  });
});

describe("diffRoutes", () => {
  test("root-level navigation targets the root outlet", () => {
    const diff = diffRoutes(manifest, "/", "/about/");
    expect(diff.boundary).toBe(root);
    expect(diff.chainToRender).toEqual([]);
  });

  test("nested sibling navigation preserves the shared nested layout", () => {
    const diff = diffRoutes(manifest, "/dashboard", "/dashboard/settings");
    expect(diff.boundary).toBe(dashboard);
    expect(diff.chainToRender).toEqual([]);
  });

  test("entering a nested layout renders from the divergence", () => {
    const diff = diffRoutes(manifest, "/about", "/dashboard/settings");
    expect(diff.boundary).toBe(root);
    expect(diff.chainToRender).toEqual([dashboard]);
  });

  test("dynamic param changes preserve layouts and rerender the page", () => {
    const diff = diffRoutes(manifest, "/dashboard/users/1", "/dashboard/users/2");
    expect(diff.boundary).toBe(users);
    expect(diff.chainToRender).toEqual([]);
  });

  test("static routes take precedence over dynamic siblings", () => {
    const diff = diffRoutes(manifest, "/", "/dashboard/users/new");
    expect(diff.target.route.pattern).toBe("/dashboard/users/new");
  });

  test("throws for unknown routes", () => {
    expect(() => diffRoutes(manifest, "/", "/missing")).toThrow("No route matches /missing");
  });
});

test("slot ids are deterministic and selector-safe", () => {
  expect(slotId("dashboard/users")).toBe("brandy-slot-dashboard-users");
});

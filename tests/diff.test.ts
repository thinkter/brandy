import { describe, expect, test } from "bun:test";
import { Html } from "@elysiajs/html";
import { diffRoutes, MalformedPathError, matchRoute, normalizePathname, RouteNotFoundError, slotId, type LayoutNode, type Route, type RouteManifest } from "brandy";

const renderLayout = ({ children }: { children: JSX.Element }) => children;
const root: LayoutNode = { id: "root", directory: "app", file: "app/layout.tsx", render: renderLayout };
const dashboard: LayoutNode = { id: "dashboard", directory: "app/dashboard", file: "app/dashboard/layout.tsx", render: renderLayout };
const users: LayoutNode = { id: "dashboard/users", directory: "app/dashboard/users", file: "app/dashboard/users/layout.tsx", render: renderLayout };

function route(pattern: string, layouts: LayoutNode[]): Route {
  const segments = pattern === "/" ? [] : pattern.slice(1).split("/");
  const pageFile = `${pattern}/page.tsx`;
  const renderPage = () => pattern;
  return { id: pattern, pattern, segments, layouts, pageFile, renderPage, page: { id: `${pattern}/page`, directory: pattern, file: pageFile, render: renderPage } };
}

const manifest: RouteManifest = {
  appDir: "/app",
  actions: new Map(),
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

  // normalizePathname must never decode: it operates on the raw pathname so that
  // route matching and param decoding (in paramsFor) see identical bytes. Decoding
  // here would throw on malformed input and, more subtly, would cause the params
  // extracted downstream to be decoded twice.
  test("never decodes and never throws on malformed percent-encoding", () => {
    expect(normalizePathname("/%")).toBe("/%");
    expect(normalizePathname("/users/%2541")).toBe("/users/%2541");
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
    expect(() => diffRoutes(manifest, "/", "/missing")).toThrow(RouteNotFoundError);
    expect(() => diffRoutes(manifest, "/", "/missing")).toThrow("No route matches /missing");
  });

  test("route-not-found errors retain the normalized pathname", () => {
    try {
      matchRoute(manifest, "https://site.test/missing/?query=ignored");
      throw new Error("Expected matchRoute to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RouteNotFoundError);
      expect((error as RouteNotFoundError).pathname).toBe("/missing");
    }
  });

  test("dynamic params are decoded exactly once", () => {
    // A literal "%41" in the URL is a doubly-encoded "A". If params were decoded
    // twice (once in normalizePathname, once in paramsFor), this would come out
    // as "A" instead of the correct single-decode result "%41".
    const match = matchRoute(manifest, "/dashboard/users/%2541");
    expect(match.params.id).toBe("%41");
  });

  test("a normally-encoded param still decodes once", () => {
    const match = matchRoute(manifest, "/dashboard/users/%20");
    expect(match.params.id).toBe(" ");
  });

  test("throws MalformedPathError for unparsable percent-encoding in a param segment", () => {
    expect(() => matchRoute(manifest, "/dashboard/users/%")).toThrow(MalformedPathError);
  });
});

test("slot ids are deterministic and selector-safe", () => {
  expect(slotId("dashboard/users")).toBe("brandy-slot-dashboard-users");
});

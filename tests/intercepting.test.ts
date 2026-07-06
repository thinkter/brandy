import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildManifest, createDevelopmentApp as createBrandy } from "brandy/build";

const appDir = new URL("../example/app", import.meta.url).pathname;

test("a (.)[id] marker links to its standalone route with the parent's segments as fromSegments", async () => {
  const manifest = await buildManifest(appDir);
  const route = manifest.routes.find((candidate) => candidate.pattern === "/dashboard/users/[id]");
  expect(route?.interceptedBy).toBeDefined();
  expect(route!.interceptedBy).toHaveLength(1);
  expect(route!.interceptedBy![0]!.fromSegments).toEqual(["dashboard", "users"]);
});

test("soft nav from the exact source location renders into the reserved modal outlet", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/users/42", {
    headers: { "x-brandy-navigation": "1", "x-brandy-current-url": "/dashboard/users" },
  }));
  expect(response.headers.get("x-brandy-retarget")).toBe("#brandy-modal-outlet");
  const html = await response.text();
  expect(html).toContain("Ada Lovelace");
  expect(html).toContain("(.)[id]");
  expect(html).toContain('<template data-brandy-head="merge">');
  expect(html).toContain("User 42 · Brandy");
});

test("soft nav from a different context renders the standalone page instead", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/users/42", {
    headers: { "x-brandy-navigation": "1", "x-brandy-current-url": "/dashboard" },
  }));
  expect(response.headers.get("x-brandy-retarget")).toBe("#brandy-slot-dashboard");
  const html = await response.text();
  expect(html).toContain('params.id = "42"');
});

test("a hard load always renders the standalone page, never the modal", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/users/42"));
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('params.id = "42"');
  expect(html).not.toContain("(.)[id]");
});

test("a same-URL re-diff (popstate closing the modal) resolves to standalone, not the modal", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/users/42", {
    headers: { "x-brandy-navigation": "1", "x-brandy-current-url": "/dashboard/users/42" },
  }));
  expect(response.headers.get("x-brandy-retarget")).not.toBe("#brandy-modal-outlet");
});

test("ordinary navigations carry an out-of-band clear for the modal outlet", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/settings", {
    headers: { "x-brandy-navigation": "1", "x-brandy-current-url": "/dashboard/users/42" },
  }));
  const html = await response.text();
  expect(html).toContain('data-brandy-stream-target="brandy-modal-outlet"');
});

test("data-brandy-no-intercept forces standalone rendering from an otherwise-eligible context", async () => {
  const app = await createBrandy({ appDir });
  const response = await app.handle(new Request("http://localhost/dashboard/users/42", {
    headers: { "x-brandy-navigation": "1", "x-brandy-current-url": "/dashboard/users", "x-brandy-no-intercept": "1" },
  }));
  expect(response.headers.get("x-brandy-retarget")).not.toBe("#brandy-modal-outlet");
});

test("the modal outlet is auto-injected on cold load once any route in the app uses interception", async () => {
  const app = await createBrandy({ appDir });
  // A route completely unrelated to interception still gets the outlet, since it's a
  // reserved app-wide anchor, not a per-route one.
  const html = await (await app.handle(new Request("http://localhost/about"))).text();
  expect(html).toContain('id="brandy-modal-outlet"');
});

test("the modal outlet is not injected at all for an app with no intercepting routes", async () => {
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "page.tsx": `import { Html } from "@elysiajs/html"; export default function Page() { return <main>home</main>; }`,
  });
  try {
    const app = await createBrandy({ appDir: dir });
    const html = await (await app.handle(new Request("http://localhost/"))).text();
    expect(html).not.toContain("brandy-modal-outlet");
  } finally {
    await cleanup();
  }
});

async function tempApp(files: Record<string, string>): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(process.cwd(), ".brandy-test-intercept-"));
  const dir = join(root, "app");
  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const full = join(dir, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }));
  return { dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const LAYOUT = `
  import { Html } from "@elysiajs/html";
  export default function Layout({ children }) {
    return <html><body>{children}</body></html>;
  }
`;

test("boot fails when an intercepting marker goes up more levels than are available", async () => {
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "page.tsx": `import { Html } from "@elysiajs/html"; export default function Page() { return <main>home</main>; }`,
    "feed/page.tsx": `import { Html } from "@elysiajs/html"; export default function Feed() { return <main>feed</main>; }`,
    "feed/(..)(..)photo/page.tsx": `import { Html } from "@elysiajs/html"; export default function Modal() { return <main>modal</main>; }`,
  });
  try {
    await expect(buildManifest(dir)).rejects.toThrow(/goes up 2 level/);
  } finally {
    await cleanup();
  }
});

test("boot fails when an intercepting marker has no matching standalone route", async () => {
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "page.tsx": `import { Html } from "@elysiajs/html"; export default function Page() { return <main>home</main>; }`,
    "feed/page.tsx": `import { Html } from "@elysiajs/html"; export default function Feed() { return <main>feed</main>; }`,
    "feed/(.)photo/page.tsx": `import { Html } from "@elysiajs/html"; export default function Modal() { return <main>modal</main>; }`,
  });
  try {
    await expect(buildManifest(dir)).rejects.toThrow(/no matching standalone route/);
  } finally {
    await cleanup();
  }
});

test("route groups are excluded from the URL path", async () => {
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "(marketing)/page.tsx": `import { Html } from "@elysiajs/html"; export default function Home() { return <main>home</main>; }`,
    "(marketing)/about/page.tsx": `import { Html } from "@elysiajs/html"; export default function About() { return <main>about</main>; }`,
    "(auth)/login/page.tsx": `import { Html } from "@elysiajs/html"; export default function Login() { return <main>login</main>; }`,
  });
  try {
    const manifest = await buildManifest(dir);
    const patterns = manifest.routes.map((route) => route.pattern).sort();
    // Route group names must NOT appear in the URL patterns
    expect(patterns).not.toContain("/(marketing)");
    expect(patterns).not.toContain("/(marketing)/about");
    expect(patterns).not.toContain("/(auth)/login");
    expect(patterns).toContain("/");
    expect(patterns).toContain("/about");
    expect(patterns).toContain("/login");

    // Requests to the unwrapped URLs must respond with 200
    const app = await createBrandy({ appDir: dir });
    expect((await app.handle(new Request("http://localhost/"))).status).toBe(200);
    expect((await app.handle(new Request("http://localhost/about"))).status).toBe(200);
    expect((await app.handle(new Request("http://localhost/login"))).status).toBe(200);
  } finally {
    await cleanup();
  }
});

test("route groups with hyphens and underscores are also excluded from the URL", async () => {
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "(my-group)/page.tsx": `import { Html } from "@elysiajs/html"; export default function Home() { return <main>home</main>; }`,
    "(my_group)/settings/page.tsx": `import { Html } from "@elysiajs/html"; export default function Settings() { return <main>settings</main>; }`,
  });
  try {
    const manifest = await buildManifest(dir);
    const patterns = manifest.routes.map((route) => route.pattern).sort();
    expect(patterns).toContain("/");
    expect(patterns).toContain("/settings");
    expect(patterns).not.toContain("/(my-group)");
    expect(patterns).not.toContain("/(my_group)/settings");
  } finally {
    await cleanup();
  }
});

test("intercept markers inside a route group still work", async () => {
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "page.tsx": `import { Html } from "@elysiajs/html"; export default function Home() { return <main>home</main>; }`,
    "photo/page.tsx": `import { Html } from "@elysiajs/html"; export default function Photo() { return <main>photo</main>; }`,
    "(feed)/page.tsx": `import { Html } from "@elysiajs/html"; export default function Feed() { return <main>feed</main>; }`,
    "(feed)/(.)photo/page.tsx": `import { Html } from "@elysiajs/html"; export default function Modal() { return <main>modal</main>; }`,
  });
  try {
    const manifest = await buildManifest(dir);
    const photoRoute = manifest.routes.find((r) => r.pattern === "/photo");
    expect(photoRoute).toBeDefined();
    expect(photoRoute!.interceptedBy).toBeDefined();
    expect(photoRoute!.interceptedBy).toHaveLength(1);
  } finally {
    await cleanup();
  }
});

test("boot fails when a directory uses parentheses but is not a route group or intercept marker", async () => {
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "page.tsx": `import { Html } from "@elysiajs/html"; export default function Page() { return <main>home</main>; }`,
    "(bad!name)/page.tsx": `import { Html } from "@elysiajs/html"; export default function Bad() { return <main>bad</main>; }`,
  });
  try {
    await expect(buildManifest(dir)).rejects.toThrow(/not a recognised intercept marker.*route group/);
  } finally {
    await cleanup();
  }
});

test("boot fails when a bare empty-parens directory name is used", async () => {
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "page.tsx": `import { Html } from "@elysiajs/html"; export default function Page() { return <main>home</main>; }`,
    "()/page.tsx": `import { Html } from "@elysiajs/html"; export default function Empty() { return <main>empty</main>; }`,
  });
  try {
    await expect(buildManifest(dir)).rejects.toThrow(/not a recognised intercept marker.*route group/);
  } finally {
    await cleanup();
  }
});

test("boot fails when two intercepting markers declare the same source location for the same target", async () => {
  // Both markers live directly in feed/ (same fromSegments) and, via different level syntax,
  // both resolve to the same root-level target — a genuine ambiguous duplicate.
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "page.tsx": `import { Html } from "@elysiajs/html"; export default function Page() { return <main>home</main>; }`,
    "feed/page.tsx": `import { Html } from "@elysiajs/html"; export default function Feed() { return <main>feed</main>; }`,
    "photo/page.tsx": `import { Html } from "@elysiajs/html"; export default function Photo() { return <main>photo</main>; }`,
    "feed/(...)photo/page.tsx": `import { Html } from "@elysiajs/html"; export default function ModalA() { return <main>a</main>; }`,
    "feed/(..)photo/page.tsx": `import { Html } from "@elysiajs/html"; export default function ModalB() { return <main>b</main>; }`,
  });
  try {
    await expect(buildManifest(dir)).rejects.toThrow(/same source location/);
  } finally {
    await cleanup();
  }
});

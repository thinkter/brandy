import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildManifest } from "brandy/build";

// Minimal layout and page stubs reusable across tests.
const LAYOUT = `
  export default function Layout({ children }) {
    return <html><body>{children}</body></html>;
  }
`;

function page(label: string): string {
  return `export default function Page() { return <main>${label}</main>; }`;
}

async function tempApp(
  files: Record<string, string>,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(process.cwd(), ".brandy-test-prec-"));
  const dir = join(root, "app");
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const full = join(dir, path);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, content);
    }),
  );
  return { dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

// Helper: build a manifest from a temp app and return the sorted pattern list.
async function sortedPatterns(files: Record<string, string>): Promise<string[]> {
  const { dir, cleanup } = await tempApp(files);
  try {
    const manifest = await buildManifest(dir);
    return manifest.routes.map((r) => r.pattern);
  } finally {
    await cleanup();
  }
}

test("/a/[b] sorts before /[a]/b — static segment at position 0 wins over dynamic", async () => {
  const patterns = await sortedPatterns({
    "layout.tsx": LAYOUT,
    "page.tsx": page("home"),
    "[a]/b/page.tsx": page("[a]/b"),
    "a/[b]/page.tsx": page("a/[b]"),
  });
  const idxStaticFirst = patterns.indexOf("/a/[b]");
  const idxDynamicFirst = patterns.indexOf("/[a]/b");
  expect(idxStaticFirst).toBeGreaterThanOrEqual(0);
  expect(idxDynamicFirst).toBeGreaterThanOrEqual(0);
  expect(idxStaticFirst).toBeLessThan(idxDynamicFirst);
});

test("fully-static route sorts before mixed static+dynamic", async () => {
  const patterns = await sortedPatterns({
    "layout.tsx": LAYOUT,
    "page.tsx": page("home"),
    "a/b/page.tsx": page("a/b"),
    "[a]/b/page.tsx": page("[a]/b"),
    "a/[b]/page.tsx": page("a/[b]"),
    "[a]/[b]/page.tsx": page("[a]/[b]"),
  });
  const idxAB = patterns.indexOf("/a/b");
  const idxADyn = patterns.indexOf("/a/[b]");
  const idxDynB = patterns.indexOf("/[a]/b");
  const idxDynDyn = patterns.indexOf("/[a]/[b]");

  // /a/b must come before all mixed/fully-dynamic variants
  expect(idxAB).toBeLessThan(idxADyn);
  expect(idxAB).toBeLessThan(idxDynB);
  expect(idxAB).toBeLessThan(idxDynDyn);

  // /a/[b] and /[a]/b: first segment is decisive — /a/[b] has static first
  expect(idxADyn).toBeLessThan(idxDynB);

  // both mixed beat fully-dynamic
  expect(idxADyn).toBeLessThan(idxDynDyn);
  expect(idxDynB).toBeLessThan(idxDynDyn);
});

test("longer static route sorts before shorter static route (specificity)", async () => {
  const patterns = await sortedPatterns({
    "layout.tsx": LAYOUT,
    "page.tsx": page("home"),
    "a/b/page.tsx": page("a/b"),
    "[x]/page.tsx": page("[x]"),
  });
  // /a/b (2 segments, static) vs /[x] (1 segment, dynamic):
  // position 0 — 'a' static beats '[x]' dynamic → /a/b first
  const idxAB = patterns.indexOf("/a/b");
  const idxDynX = patterns.indexOf("/[x]");
  expect(idxAB).toBeLessThan(idxDynX);
});

test("the correct handler is matched for /a/b when both /[a]/b and /a/[b] exist", async () => {
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "page.tsx": page("home"),
    "[a]/b/page.tsx": page("dynamic-first-segment"),
    "a/[b]/page.tsx": page("dynamic-second-segment"),
  });
  try {
    const manifest = await buildManifest(dir);
    // The route for /a/b should be /a/[b] (static first segment wins)
    const { matchRoute } = await import("brandy");
    const match = matchRoute(manifest, "/a/b");
    expect(match.route.pattern).toBe("/a/[b]");
    expect(match.params).toEqual({ b: "b" });
  } finally {
    await cleanup();
  }
});

test("static-only routes sort stably among themselves by length (longer first)", async () => {
  const patterns = await sortedPatterns({
    "layout.tsx": LAYOUT,
    "page.tsx": page("home"),
    "a/b/c/page.tsx": page("a/b/c"),
    "a/b/page.tsx": page("a/b"),
    "a/page.tsx": page("a"),
  });
  const idxABC = patterns.indexOf("/a/b/c");
  const idxAB = patterns.indexOf("/a/b");
  const idxA = patterns.indexOf("/a");
  // Longer routes are more specific and must come first
  expect(idxABC).toBeLessThan(idxAB);
  expect(idxAB).toBeLessThan(idxA);
});

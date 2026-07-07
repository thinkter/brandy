import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildManifest } from "brandy/build";

// Minimal layout/page stubs reusable across tests, matching the conventions in
// tests/route-precedence.test.ts.
const LAYOUT = `
  export default function Layout({ children }) {
    return <html><body>{children}</body></html>;
  }
`;

function page(label: string): string {
  return `export default function Page() { return <main>${label}</main>; }`;
}

const ACTIONS = `
  export async function save() {
    return "saved";
  }
`;

async function tempApp(files: Record<string, string>): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(process.cwd(), ".brandy-test-rebind-"));
  const dir = join(root, "app");
  await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const full = join(dir, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }));
  return { dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("a directory rename between dev rebuilds does not permanently break the walker", async () => {
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "page.tsx": page("home"),
    "dashboard/page.tsx": page("dashboard"),
    "dashboard/actions.ts": ACTIONS,
  });
  try {
    // First walk (simulates the dev server's initial build): binds the `save` handler to
    // its /_brandy/actions/... path under "dashboard".
    const first = await buildManifest(dir, "v1");
    const firstPaths = [...first.actions.keys()];
    expect(firstPaths).toHaveLength(1);
    expect(firstPaths[0]).toStartWith("/_brandy/actions/");

    // Simulate renaming the directory containing actions.ts while the dev server is running.
    await rename(join(dir, "dashboard"), join(dir, "workspace"));

    // Second walk (simulates the rebuild the file watcher triggers on rename): Bun's module
    // cache is bypassed via a new cacheBust query string, but the underlying `save` function
    // the bundler resolves to keeps its identity — that's exactly the scenario that used to
    // hit the "already bound" guard and throw on every subsequent rebuild.
    const second = await buildManifest(dir, "v2");
    const secondPaths = [...second.actions.keys()];
    expect(secondPaths).toHaveLength(1);
    expect(secondPaths[0]).toStartWith("/_brandy/actions/");
    // The path must reflect the new segment path ("workspace"), not the stale "dashboard" one.
    expect(secondPaths[0]).not.toBe(firstPaths[0]);
    const decoded = Buffer.from(secondPaths[0]!.replace("/_brandy/actions/", ""), "base64url").toString();
    expect(decoded).toBe("workspace:save");

    // A third walk with nothing changed should be stable and not throw either.
    const third = await buildManifest(dir, "v3");
    expect([...third.actions.keys()]).toEqual(secondPaths);
  } finally {
    await cleanup();
  }
});

test("two distinct handlers resolving to the same function identity within one walk still error", async () => {
  const { dir, cleanup } = await tempApp({
    "layout.tsx": LAYOUT,
    "page.tsx": page("home"),
    "shared.ts": `
      export async function shared() {
        return "shared";
      }
    `,
    "a/page.tsx": page("a"),
    "a/actions.ts": `
      export { shared } from "../shared.ts";
    `,
    "b/page.tsx": page("b"),
    "b/actions.ts": `
      export { shared } from "../shared.ts";
    `,
  });
  try {
    await expect(buildManifest(dir, "v1")).rejects.toThrow(/already bound/);
  } finally {
    await cleanup();
  }
});

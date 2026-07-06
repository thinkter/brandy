import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bun, cloudflare, vercel } from "brandy/adapters";
import { buildApplication } from "brandy/build";
import { loadConfig } from "../src/tooling.ts";

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(pageExport = "export const prerender = true;") {
  const root = await mkdtemp(join(process.cwd(), ".brandy-test-adapter-"));
  roots.push(root);
  await mkdir(join(root, "app"), { recursive: true });
  await writeFile(join(root, "app/layout.tsx"), `
    import { Html } from "@elysiajs/html";
    export default function Layout({ children }) {
      return <html><head></head><body>{children}</body></html>;
    }
  `);
  await writeFile(join(root, "app/page.tsx"), `
    import { Html } from "@elysiajs/html";
    ${pageExport}
    export function load() { return "portable"; }
    export default function Page({ data }) { return <main>{data}</main>; }
  `);
  await mkdir(join(root, "public"), { recursive: true });
  await writeFile(join(root, "public/hello.txt"), "hello");
  await writeFile(join(root, "public/hello.a1b2c3d4.txt"), "fingerprinted hello");
  const config = await loadConfig(root);
  config.styles = false;
  return { root, config };
}

function assetBinding(directory: string) {
  return {
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      const file = Bun.file(join(directory, path));
      return await file.exists() ? new Response(file) : new Response("Not found", { status: 404 });
    },
  };
}

test("adapter factories expose stable runtime descriptors", () => {
  expect(bun().runtime).toBe("bun");
  expect(cloudflare().runtime).toBe("cloudflare");
  expect(vercel({ runtime: "node" }).runtime).toBe("vercel-node");
  expect(vercel({ runtime: "edge" }).runtime).toBe("vercel-edge");
});

test("Bun output serves framework and public assets with appropriate cache policies", async () => {
  const { root, config } = await fixture();
  const output = join(root, "bun");
  const port = 32_000 + Math.floor(Math.random() * 1_000);
  config.port = port;
  config.adapter = bun({ outputDir: output });
  expect(await buildApplication(config)).toBe(output);

  const child = Bun.spawn([process.execPath, join(output, "server.js")], { stdout: "ignore", stderr: "pipe" });
  try {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { response = await fetch(`http://localhost:${port}/`); break; }
      catch { await Bun.sleep(25); }
    }
    expect(response?.status).toBe(200);
    expect(await response!.text()).toContain("portable");
    const metadata = JSON.parse(await readFile(join(output, "build.json"), "utf8"));
    const runtime = await fetch(`http://localhost:${port}${metadata.assets.runtime}`);
    expect(runtime.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const publicAsset = await fetch(`http://localhost:${port}/hello.txt`);
    expect(await publicAsset.text()).toBe("hello");
    expect(publicAsset.headers.get("cache-control")).toBe("public, max-age=3600");
    const fingerprintedAsset = await fetch(`http://localhost:${port}/hello.a1b2c3d4.txt`);
    expect(await fingerprintedAsset.text()).toBe("fingerprinted hello");
    expect(fingerprintedAsset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  } finally {
    child.kill();
    await child.exited;
  }
});

test("Cloudflare output is a fetch worker with static assets and immutable prerendering", async () => {
  const { root, config } = await fixture();
  const output = join(root, "cloudflare");
  config.adapter = cloudflare({ outputDir: output, compatibilityDate: "2025-06-01" });
  expect(await buildApplication(config)).toBe(output);

  const wrangler = JSON.parse(await readFile(join(output, "wrangler.jsonc"), "utf8"));
  expect(wrangler.compatibility_flags).toContain("nodejs_compat");
  expect(wrangler.assets.run_worker_first).toBe(true);
  expect(await Bun.file(join(output, "assets/hello.txt")).text()).toBe("hello");

  const worker = (await import(`${join(output, "worker.js")}?v=${crypto.randomUUID()}`)).default;
  expect(await readFile(join(output, "worker.js"), "utf8")).not.toMatch(/\b(?:eval|Function)\s*\(/);
  const env = { ASSETS: assetBinding(join(output, "assets")) };
  const hard = await worker.fetch(new Request("http://localhost/"), env, {});
  expect(hard.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  expect(await hard.text()).toContain("portable");
  const partial = await worker.fetch(new Request("http://localhost/", { headers: {
    "x-brandy-navigation": "1", "x-brandy-current-url": "/",
  }}), env, {});
  expect(await partial.text()).toContain("portable");
});

test("Vercel emits Node and Edge Build Output API functions", async () => {
  for (const runtime of ["node", "edge"] as const) {
    const { root, config } = await fixture();
    const output = join(root, `.vercel-${runtime}/output`);
    config.adapter = vercel({ runtime, outputDir: output });
    expect(await buildApplication(config)).toBe(output);

    const deployment = JSON.parse(await readFile(join(output, "config.json"), "utf8"));
    const functionConfig = JSON.parse(await readFile(join(output, "functions/index.func/.vc-config.json"), "utf8"));
    expect(deployment.version).toBe(3);
    expect(deployment.routes.some((route: { dest?: string; headers?: Record<string, string> }) =>
      route.dest?.startsWith("/_brandy/pages/") && route.headers?.["cache-control"]?.includes("immutable")
    )).toBe(true);
    expect(functionConfig.runtime).toBe(runtime === "edge" ? "edge" : "nodejs22.x");
    expect(await Bun.file(join(output, "static/hello.txt")).text()).toBe("hello");

    const functionFile = join(output, `functions/index.func/${runtime === "edge" ? "index.js" : "index.mjs"}`);
    const bundled = await readFile(functionFile, "utf8");
    if (runtime === "edge") expect(bundled).not.toMatch(/\b(?:eval|Function)\s*\(/);
    const handler = (await import(`${functionFile}?v=${crypto.randomUUID()}`)).default;
    const response = await handler.fetch(new Request("http://localhost/"));
    expect(await response.text()).toContain("portable");
  }
});

test("serverless adapters reject mutable or non-enumerable prerendering", async () => {
  const mutable = await fixture("export const revalidate = 60;");
  mutable.config.adapter = cloudflare({ outputDir: join(mutable.root, "output") });
  await expect(buildApplication(mutable.config)).rejects.toThrow("requires a durable cache");

  const dynamic = await fixture();
  await rm(join(dynamic.root, "app/page.tsx"));
  await mkdir(join(dynamic.root, "app/[id]"));
  await writeFile(join(dynamic.root, "app/[id]/page.tsx"), `
    export const prerender = true;
    export default function Page({ params }) { return params.id; }
  `);
  dynamic.config.adapter = vercel({ runtime: "edge", outputDir: join(dynamic.root, "output") });
  await expect(buildApplication(dynamic.config)).rejects.toThrow("requires static parameter enumeration");
});

test("edge and Node adapters reject incompatible application APIs with a source path", async () => {
  const edge = await fixture("");
  await writeFile(join(edge.root, "app/page.tsx"), `
    import { readFile } from "node:fs/promises";
    export default async function Page() { return await readFile("secret", "utf8"); }
  `);
  edge.config.adapter = vercel({ runtime: "edge", outputDir: join(edge.root, "edge") });
  await expect(buildApplication(edge.config)).rejects.toThrow(/node:fs\/promises.*unavailable in edge runtimes/);

  const node = await fixture("");
  await writeFile(join(node.root, "app/page.tsx"), `
    export default function Page() { return Bun.version; }
  `);
  node.config.adapter = vercel({ runtime: "node", outputDir: join(node.root, "node") });
  await expect(buildApplication(node.config)).rejects.toThrow(/page\.tsx uses the Bun global/);
});

test("the portable request runtime has no filesystem, subprocess, or Bun dependencies", async () => {
  const source = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
  expect(source).not.toMatch(/\bBun\./);
  expect(source).not.toMatch(/node:(?:fs|path|child_process)/);
  expect(source).not.toContain("buildManifest");
});

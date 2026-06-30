import { access, readdir } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { buildManifest } from "./core/walker.ts";
import type { LayoutNode, PageNode } from "./core/types.ts";
import { compileStyles, copyDirectory, latestMtime, resetDirectory, type ResolvedConfig } from "./tooling.ts";
import { buildClientRuntime } from "./server.ts";

async function existing(file: string): Promise<boolean> { try { await access(file); return true; } catch { return false; } }
const ERROR_FILES = ["error.tsx", "error.ts", "error.jsx", "error.js"];
const NOT_FOUND_FILES = ["not-found.tsx", "not-found.ts", "not-found.jsx", "not-found.js"];

async function nearest(directory: string, appDir: string, names: string[]): Promise<string | undefined> {
  let current = directory;
  while (current.startsWith(appDir)) {
    for (const name of names) { const file = join(current, name); if (await existing(file)) return file; }
    if (current === appDir) break;
    current = dirname(current);
  }
}

async function publicPaths(directory: string | false): Promise<string[]> {
  if (!directory || !await existing(directory)) return [];
  const result: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else result.push(`/${relative(directory as string, path).split(sep).join("/")}`);
    }
  }
  await walk(directory); return result;
}

export async function buildApplication(config: ResolvedConfig): Promise<void> {
  const manifest = await buildManifest(config.appDir);
  const assets = await publicPaths(config.publicDir);
  const conflicts = assets.filter((path) => path.startsWith("/_brandy/") || manifest.routes.some((route) => !route.pattern.includes(":") && route.pattern === path));
  if (conflicts.length) throw new Error(`Public files conflict with Brandy routes: ${conflicts.join(", ")}`);
  const styles = await compileStyles(config.styles, true);
  const runtime = await buildClientRuntime(config.alpine);
  await resetDirectory(config.outDir);

  const imports = new Map<string, string>();
  const imported = (file: string | undefined) => {
    if (!file) return undefined;
    let name = imports.get(file);
    if (!name) { name = `m${imports.size}`; imports.set(file, name); }
    return name;
  };
  for (const route of manifest.routes) {
    for (const layout of route.layouts) {
      imported(layout.file); imported(await nearest(layout.directory, config.appDir, ERROR_FILES));
      imported(await nearest(layout.directory, config.appDir, NOT_FOUND_FILES));
    }
    imported(route.page.file); imported(await nearest(route.page.directory, config.appDir, ERROR_FILES));
    imported(await nearest(route.page.directory, config.appDir, NOT_FOUND_FILES));
  }
  for (const action of manifest.actions.values()) imported(action.file);
  if (config.configFile) imported(config.configFile);

  const boundary = async (node: LayoutNode | PageNode, files: string[], key: string) => {
    const file = await nearest(node.directory, config.appDir, files); const name = imported(file);
    return name ? `, ${key}: ${name}.default` : "";
  };
  const layouts = new Map<string, string>();
  for (const route of manifest.routes) for (const node of route.layouts) if (!layouts.has(node.file)) {
    const mod = imported(node.file)!;
    layouts.set(node.file, `{ id:${JSON.stringify(node.id)}, directory:${JSON.stringify(node.directory)}, file:${JSON.stringify(node.file)}, render:${mod}.default, load:${mod}.load, metadata:${mod}.metadata${await boundary(node, ERROR_FILES, "renderError")}${await boundary(node, NOT_FOUND_FILES, "renderNotFound")} }`);
  }
  const routes: string[] = [];
  for (const route of manifest.routes) {
    const page = route.page; const mod = imported(page.file)!;
    const pageCode = `{ id:${JSON.stringify(page.id)}, directory:${JSON.stringify(page.directory)}, file:${JSON.stringify(page.file)}, render:${mod}.default, load:${mod}.load, metadata:${mod}.metadata${await boundary(page, ERROR_FILES, "renderError")}${await boundary(page, NOT_FOUND_FILES, "renderNotFound")} }`;
    routes.push(`{ id:${JSON.stringify(route.id)}, pattern:${JSON.stringify(route.pattern)}, segments:${JSON.stringify(route.segments)}, layouts:[${route.layouts.map((item) => layouts.get(item.file)).join(",")}], page:${pageCode}, pageFile:${JSON.stringify(page.file)}, renderPage:${mod}.default }`);
  }
  const actions = [...manifest.actions.values()].map((action) => {
    const mod = imported(action.file)!;
    return `registerAction(${JSON.stringify(action.id)},${JSON.stringify(action.path)},${JSON.stringify(action.segmentPath)},${JSON.stringify(action.file)},${JSON.stringify(action.name)},${mod}[${JSON.stringify(action.name)}])`;
  });
  const serverImport = new URL("./server.ts", import.meta.url).pathname;
  const rootNotFoundModule = imported(await nearest(config.appDir, config.appDir, NOT_FOUND_FILES));
  const source = `${[...imports].map(([file, name]) => `import * as ${name} from ${JSON.stringify(file)};`).join("\n")}
import { createBrandy } from ${JSON.stringify(serverImport)};
const actions = new Map();
function registerAction(id,path,segmentPath,file,name,handler){Object.defineProperty(handler,"toString",{configurable:true,value:()=>path});actions.set(path,{id,path,segmentPath,file,name,handler});}
${actions.join(";\n")}
const manifest={appDir:${JSON.stringify(config.appDir)},routes:[${routes.join(",\n")}],actions,rootNotFound:${rootNotFoundModule ? `${rootNotFoundModule}.default` : "undefined"}};
const config=${config.configFile ? `${imported(config.configFile)}.default ?? {}` : "{}"};
const app=await createBrandy({manifest,alpine:${config.alpine},runtime:${JSON.stringify(runtime)},stylesheet:${JSON.stringify(styles)},publicDir:${JSON.stringify(join(config.outDir, "public"))},setup:config.setup});
app.listen({port:Number(process.env.PORT)||${config.port},hostname:process.env.HOST||${JSON.stringify(config.host)}});
console.log(\`Brandy listening at \${app.server?.url}\`);
`;
  const entry = join(config.outDir, "entry.ts");
  await Bun.write(entry, source);
  const result = await Bun.build({ entrypoints: [entry], outdir: config.outDir, naming: "server.js", target: "bun", minify: true, sourcemap: "linked" });
  if (!result.success) throw new AggregateError(result.logs, "Brandy production build failed");
  await Bun.file(entry).delete();
  await copyDirectory(config.publicDir, join(config.outDir, "public"));
  await Bun.write(join(config.outDir, "build.json"), JSON.stringify({ version: 1, sourceMtime: await latestMtime([config.appDir, config.styles, config.publicDir, config.configFile]), builtAt: Date.now() }, null, 2));
}

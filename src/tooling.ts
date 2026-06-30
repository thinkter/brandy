import { access, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BrandyConfig } from "./config.ts";

export interface ResolvedConfig extends Required<Omit<BrandyConfig, "setup">> {
  root: string;
  setup?: BrandyConfig["setup"];
  configFile?: string;
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function loadConfig(root = process.cwd(), version?: string): Promise<ResolvedConfig> {
  let configFile: string | undefined;
  for (const name of ["brandy.config.ts", "brandy.config.js", "brandy.config.mjs"]) {
    const candidate = join(root, name);
    if (await exists(candidate)) { configFile = candidate; break; }
  }
  let value: BrandyConfig = {};
  if (configFile && await exists(configFile)) {
    const module = await import(`${configFile}${version ? `?v=${version}` : ""}`) as { default?: BrandyConfig };
    value = module.default ?? {};
  }
  const path = (input: string) => resolve(root, input);
  return {
    root,
    appDir: path(value.appDir ?? "app"), outDir: path(value.outDir ?? ".brandy"),
    publicDir: value.publicDir === false ? false : path(value.publicDir ?? "public"),
    styles: value.styles === false ? false : path(value.styles ?? "styles.css"),
    alpine: value.alpine ?? true, port: value.port ?? 3000, host: value.host ?? "localhost",
    trustedOrigins: value.trustedOrigins ?? [],
    setup: value.setup, configFile,
  };
}

export async function compileStyles(file: string | false, minify: boolean): Promise<string | undefined> {
  if (!file || !await exists(file)) return undefined;
  const executable = new URL("./dist/index.mjs", import.meta.resolve("@tailwindcss/cli/package.json")).pathname;
  const child = Bun.spawn([process.execPath, executable, "--input", file, ...(minify ? ["--minify"] : [])], {
    cwd: dirname(file), stdout: "pipe", stderr: "pipe",
  });
  const [output, error, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`Tailwind build failed:\n${error}`);
  return output;
}

export async function resetDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

export async function copyDirectory(from: string | false, to: string): Promise<void> {
  if (!from || !await exists(from)) return;
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name); const target = join(to, entry.name);
    if (entry.isDirectory()) await copyDirectory(source, target);
    else await Bun.write(target, Bun.file(source));
  }
}

export async function latestMtime(paths: Array<string | false | undefined>): Promise<number> {
  let latest = 0;
  async function visit(path: string): Promise<void> {
    if (!await exists(path)) return;
    const info = await stat(path); latest = Math.max(latest, info.mtimeMs);
    if (info.isDirectory()) for (const entry of await readdir(path)) await visit(join(path, entry));
  }
  for (const path of paths) if (path) await visit(path);
  return latest;
}

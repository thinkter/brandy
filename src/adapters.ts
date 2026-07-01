export type AdapterRuntime = "bun" | "cloudflare" | "vercel-node" | "vercel-edge";

export interface DeploymentAdapter {
  readonly name: "bun" | "cloudflare" | "vercel";
  readonly runtime: AdapterRuntime;
  readonly outputDir?: string;
  readonly compatibilityDate?: string;
  readonly projectName?: string;
}

export interface BunAdapterOptions {
  outputDir?: string;
}

export interface CloudflareAdapterOptions {
  outputDir?: string;
  compatibilityDate?: string;
  name?: string;
}

export interface VercelAdapterOptions {
  runtime: "node" | "edge";
  outputDir?: string;
}

export function bun(options: BunAdapterOptions = {}): DeploymentAdapter {
  return { name: "bun", runtime: "bun", outputDir: options.outputDir };
}

export function cloudflare(options: CloudflareAdapterOptions = {}): DeploymentAdapter {
  return {
    name: "cloudflare",
    runtime: "cloudflare",
    outputDir: options.outputDir,
    compatibilityDate: options.compatibilityDate ?? "2025-06-01",
    projectName: options.name,
  };
}

export function vercel(options: VercelAdapterOptions): DeploymentAdapter {
  return {
    name: "vercel",
    runtime: options.runtime === "edge" ? "vercel-edge" : "vercel-node",
    outputDir: options.outputDir,
  };
}

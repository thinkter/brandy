import type { Elysia } from "elysia";

export interface BrandyConfig {
  appDir?: string;
  outDir?: string;
  publicDir?: string | false;
  styles?: string | false;
  alpine?: boolean;
  port?: number;
  host?: string;
  setup?: (app: Elysia) => void | Promise<void>;
}

export function defineConfig(config: BrandyConfig): BrandyConfig {
  return config;
}

import { bun, type DeploymentAdapter } from "./adapters.ts";
import type { BrandyApplication } from "./server.ts";

export interface BrandyConfig {
  appDir?: string;
  outDir?: string;
  publicDir?: string | false;
  styles?: string | false;
  alpine?: boolean;
  port?: number;
  host?: string;
  trustedOrigins?: string[];
  adapter?: DeploymentAdapter;
  setup?: (app: BrandyApplication) => void | Promise<void>;
  /** Caps the number of entries the in-memory render cache holds; the least-recently-used entry
   * is evicted once exceeded. Defaults to `DEFAULT_RENDER_CACHE_MAX_ENTRIES`. */
  renderCacheMaxEntries?: number;
}

export function defineConfig(config: BrandyConfig): BrandyConfig {
  return config;
}

export const defaultAdapter = bun();

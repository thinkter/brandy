/** Bun-only browser compilation used by the build tool and development server. */

export const DEFAULT_ALPINE_CHUNK_PATH = "/_brandy/alpine.js";

async function buildBrowserBundle(entrypoint: string, options?: { define?: Record<string, string>; external?: string[] }): Promise<string> {
  const build = await Bun.build({ entrypoints: [new URL(entrypoint, import.meta.url).pathname], target: "browser", minify: true, ...options });
  if (!build.success || !build.outputs[0]) throw new AggregateError(build.logs, "Failed to build the Brandy client runtime");
  return build.outputs[0].text();
}

export function buildClientRuntime(alpineChunkPath: string, dev: boolean): Promise<string> {
  return buildBrowserBundle("./client/runtime.ts", {
    define: { __BRANDY_ALPINE_CHUNK__: JSON.stringify(alpineChunkPath), __BRANDY_DEV__: JSON.stringify(dev) },
    external: [alpineChunkPath],
  });
}

export function buildAlpineChunk(): Promise<string> {
  return buildBrowserBundle("./client/runtime-alpine.ts");
}

const runtimeBuilds = new Map<string, Promise<string>>();

export function compiledRuntime(alpineChunkPath: string, dev: boolean): Promise<string> {
  const key = `${alpineChunkPath}\0${dev}`;
  const existing = runtimeBuilds.get(key);
  if (existing) return existing;
  const build = buildClientRuntime(alpineChunkPath, dev);
  runtimeBuilds.set(key, build);
  return build;
}

let alpineChunkBuild: Promise<string> | undefined;

export function compiledAlpineChunk(): Promise<string> {
  return alpineChunkBuild ??= buildAlpineChunk();
}

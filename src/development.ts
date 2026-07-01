import { isAbsolute, relative, resolve, sep } from "node:path";
import { compiledAlpineChunk, compiledRuntime, DEFAULT_ALPINE_CHUNK_PATH } from "./browser.ts";
import { buildManifest } from "./core/walker.ts";
import { createBrandy, type BrandyOptions } from "./server.ts";

export interface DevelopmentAppOptions extends Omit<BrandyOptions, "manifest" | "serveAsset"> {
  appDir?: string;
  publicDir?: string | false;
  alpine?: boolean;
  cacheBust?: string;
}

function publicAssetHandler(publicDir: string | false | undefined) {
  if (!publicDir) return undefined;
  const root = resolve(publicDir);
  return async (request: Request): Promise<Response | undefined> => {
    const pathname = decodeURIComponent(new URL(request.url).pathname);
    if (pathname.startsWith("/_brandy/")) return undefined;
    const filePath = resolve(root, pathname.slice(1));
    const relativePath = relative(root, filePath);
    const inside = relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
    if (!inside) return undefined;
    const file = Bun.file(filePath);
    return await file.exists() ? new Response(file) : undefined;
  };
}

export async function createDevelopmentApp(options: DevelopmentAppOptions = {}) {
  const manifest = await buildManifest(options.appDir ?? "app", options.cacheBust);
  const alpineChunkPath = options.alpineChunkPath ?? DEFAULT_ALPINE_CHUNK_PATH;
  const runtime = options.runtime ?? await compiledRuntime(alpineChunkPath, options.dev === true);
  const alpineChunk = options.alpineChunk ?? (options.alpine === false ? undefined : await compiledAlpineChunk());
  return createBrandy({
    ...options,
    manifest,
    runtime,
    alpineChunk,
    alpineChunkPath,
    stylesheetPath: options.stylesheet ? options.stylesheetPath ?? "/_brandy/app.css" : undefined,
    serveAsset: publicAssetHandler(options.publicDir),
  });
}

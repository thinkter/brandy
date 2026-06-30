import { Elysia } from "elysia";
import { diffRoutes, matchRoute } from "./core/diff.ts";
import { normalizePathname, slotId } from "./core/path.ts";
import { renderFragment, renderFull } from "./core/render.ts";
import { buildManifest } from "./core/walker.ts";

export const PARTIAL_HEADER = "x-brandy-navigation";
export const CURRENT_URL_HEADER = "x-brandy-current-url";
export const RETARGET_HEADER = "x-brandy-retarget";
export const RESWAP_HEADER = "x-brandy-reswap";

export interface BrandyOptions {
  appDir: string;
  clientPath?: string;
}

export async function createBrandy(options: BrandyOptions): Promise<Elysia> {
  const manifest = await buildManifest(options.appDir);
  const clientPath = options.clientPath ?? "/_brandy/runtime.js";
  const build = await Bun.build({
    entrypoints: [new URL("./client/runtime.ts", import.meta.url).pathname],
    target: "browser",
    minify: true,
  });
  if (!build.success || !build.outputs[0]) {
    throw new AggregateError(build.logs, "Failed to build the Brandy client runtime");
  }
  const runtime = await build.outputs[0].text();
  const app = new Elysia();

  app.get(clientPath, () => new Response(runtime, {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" },
  }));

  app.get("/*", async ({ request, set }) => {
    const targetURL = normalizePathname(request.url);
    try {
      if (request.headers.get(PARTIAL_HEADER) === "1") {
        const currentURL = request.headers.get(CURRENT_URL_HEADER);
        if (!currentURL) {
          set.status = 400;
          return "Missing x-brandy-current-url header";
        }
        const diff = diffRoutes(manifest, currentURL, targetURL);
        set.headers[RETARGET_HEADER] = `#${slotId(diff.boundary.id)}`;
        set.headers[RESWAP_HEADER] = "innerHTML";
        set.headers["vary"] = `${PARTIAL_HEADER}, ${CURRENT_URL_HEADER}`;
        set.headers["content-type"] = "text/html; charset=utf-8";
        return renderFragment(diff);
      }

      const match = matchRoute(manifest, targetURL);
      set.headers["content-type"] = "text/html; charset=utf-8";
      return renderFull(match.route);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No route matches")) {
        set.status = 404;
        return "Not found";
      }
      throw error;
    }
  });
  return app;
}

export * from "./core/diff.ts";
export * from "./core/path.ts";
export * from "./core/render.ts";
export * from "./core/types.ts";
export * from "./core/walker.ts";

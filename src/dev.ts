import { watch } from "node:fs";
import { basename, dirname, relative, sep } from "node:path";
import { createBrandy } from "./server.ts";
import { compileStyles, loadConfig, type ResolvedConfig } from "./tooling.ts";

const DEV_CLIENT = `
const events=new EventSource('/_brandy/dev-events');
events.addEventListener('reload',()=>location.reload());
events.addEventListener('css',()=>{for(const link of document.querySelectorAll('link[href^="/_brandy/app.css"]')){const url=new URL(link.href);url.searchParams.set('v',Date.now());link.href=url}});
events.addEventListener('boundary',async(event)=>{try{const headers={'x-brandy-navigation':'1','x-brandy-current-url':location.pathname};if(event.data!=='page')headers['x-brandy-refresh-boundary']=event.data;const response=await fetch(location.href,{headers});if(!response.ok)throw new Error(await response.text());if(response.headers.get('x-brandy-stream')==='1'){location.reload();return}const html=await response.text();const target=response.headers.get('x-brandy-retarget');if(!target)return;const element=document.querySelector(target);if(!element)return;const template=document.createElement('template');template.innerHTML=html;const head=template.content.querySelector('template[data-brandy-head]');if(head){document.querySelectorAll('[data-brandy-metadata]').forEach(node=>node.remove());document.head.append(head.content.cloneNode(true));head.remove()}element.innerHTML=template.innerHTML;window.Brandy?.reinit?.(element)}catch(error){console.error('[brandy] HMR failed',error)}});
events.onerror=()=>console.warn('[brandy] development connection lost');
`;

export async function runDev(initialConfig: ResolvedConfig): Promise<never> {
  let config = initialConfig;
  const clients = new Set<ReadableStreamDefaultController>();
  let version = Date.now();
  let styles = await compileStyles(config.styles, false);
  const setup = async (app: Parameters<NonNullable<ResolvedConfig["setup"]>>[0]) => {
    await config.setup?.(app);
    app.get("/_brandy/dev.js", () => new Response(DEV_CLIENT, { headers: { "content-type": "text/javascript", "cache-control": "no-cache" } }));
    app.get("/_brandy/dev-events", () => new Response(new ReadableStream({
      start(controller) { clients.add(controller); controller.enqueue(": connected\n\n"); },
      cancel(controller) { clients.delete(controller as unknown as ReadableStreamDefaultController); },
    }), { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } }));
  };
  let current = await createBrandy({ appDir: config.appDir, alpine: config.alpine, stylesheet: styles, publicDir: config.publicDir, trustedOrigins: config.trustedOrigins, dev: true, setup, cacheBust: String(version) });
  const port = config.port; const hostname = config.host;
  const server = Bun.serve({ port, hostname, fetch: (request) => current.handle(request) });
  console.log(`Brandy dev server at ${server.url}`);

  const send = (event: string, data = "") => {
    const payload = new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
    for (const client of clients) try { client.enqueue(payload); } catch { clients.delete(client); }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(config.root, { recursive: true }, (_event, filename) => {
    if (!filename || filename.startsWith(".brandy") || filename.startsWith(".git") || filename.includes("node_modules")) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const changed = filename.split(sep).join("/");
        if (config.styles && changed === relative(config.root, config.styles).split(sep).join("/")) {
          styles = await compileStyles(config.styles, false);
          current = await createBrandy({ appDir: config.appDir, alpine: config.alpine, stylesheet: styles, publicDir: config.publicDir, trustedOrigins: config.trustedOrigins, dev: true, setup, cacheBust: String(version) });
          send("css"); return;
        }
        version++;
        const name = basename(changed);
        if (changed.startsWith("brandy.config.")) {
          config = await loadConfig(config.root, String(version));
          styles = await compileStyles(config.styles, false);
        }
        current = await createBrandy({ appDir: config.appDir, alpine: config.alpine, stylesheet: styles, publicDir: config.publicDir, trustedOrigins: config.trustedOrigins, dev: true, setup, cacheBust: String(version) });
        if (changed.startsWith("brandy.config.") || !changed.startsWith(`${relative(config.root, config.appDir).split(sep).join("/")}/`)) send("reload");
        else if (/^layout\.[jt]sx?$/.test(name)) {
          const segment = relative(config.appDir, dirname(`${config.root}/${changed}`)).split(sep).join("/");
          if (!segment) send("reload"); else send("boundary", segment);
        } else if (/^(page|actions|error|not-found|loading)\.[jt]sx?$/.test(name)) send("boundary", "page");
        else send("reload");
      } catch (error) { console.error("[brandy] rebuild failed", error); }
    }, 60);
  });
  process.on("SIGINT", () => { watcher.close(); server.stop(); process.exit(0); });
  return await new Promise<never>(() => {});
}

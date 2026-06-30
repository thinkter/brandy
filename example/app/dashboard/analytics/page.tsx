import { Html } from "@elysiajs/html";
import type { Metadata, RenderContext } from "brandy";

export const metadata: Metadata = { title: "Analytics · Brandy" };

export async function load() {
  await Bun.sleep(4000);
  return { visitors: 1284, loadedAt: new Date().toISOString() };
}

type AnalyticsData =
  ReturnType<typeof load> extends Promise<infer T> ? T : never;

export default function Analytics({ data }: RenderContext<AnalyticsData>) {
  return (
    <section>
      <h1 class="text-3xl font-bold">
        Analytics (Loader test with 4000ms delay)
      </h1>
      <p class="mt-2 text-zinc-400">
        This page has a <code>loading.tsx</code> in the same directory and a
        slow loader. Brandy streams the skeleton immediately and swaps in the
        real content once the loader resolves — on both a full page load and a
        soft navigation.
      </p>
      <div class="mt-8 rounded border border-zinc-800 bg-zinc-900/30 p-5">
        <p class="text-sm text-zinc-500">Visitors today</p>
        <p class="mt-1 text-4xl font-bold">{data.visitors}</p>
      </div>
      <p class="mt-4 text-xs text-zinc-500">
        Loader trace: <code>{data.loadedAt}</code>
      </p>
    </section>
  );
}

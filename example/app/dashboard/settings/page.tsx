import { Html } from "@elysiajs/html";
import type { Metadata, RenderContext } from "brandy";

export const metadata: Metadata = { title: "Settings · Brandy" };

export function load({ request }: RenderContext<undefined>) {
  return { prefetched: request.headers.get("x-brandy-prefetch") === "1" };
}

type SettingsData = ReturnType<typeof load>;

export default function Settings({ data }: RenderContext<SettingsData>) {
  return (
    <section x-data="{ compact: false, notices: true }">
      <h1 class="text-3xl font-bold">Client settings</h1>
      <p class="mt-2 text-zinc-400">These controls use Alpine and do not contact the server.</p>
      <p class="mt-2 text-xs text-zinc-500">
        This page is hover-prefetched from the dashboard nav. Loader saw:{" "}
        <code>{data.prefetched ? "prefetch request" : "live navigation"}</code>
      </p>

      <div class="mt-8 divide-y divide-zinc-800 rounded border border-zinc-800 bg-zinc-900/30">
        <label class="flex items-center justify-between p-4">
          <span>Compact view</span>
          <input type="checkbox" x-model="compact" />
        </label>
        <label class="flex items-center justify-between p-4">
          <span>Show notifications</span>
          <input type="checkbox" x-model="notices" />
        </label>
      </div>

      <div class="mt-5 rounded border border-zinc-800" x-bind:class="compact ? 'p-2' : 'p-5'">
        <strong>Preview</strong>
        <p class="mt-2 text-zinc-400" x-show="notices">Notifications are enabled.</p>
      </div>
    </section>
  );
}

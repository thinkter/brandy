import { Html } from "@elysiajs/html";
import type { Metadata } from "brandy";
import { increment } from "./actions.ts";
import { getCount } from "./state.ts";

export const metadata: Metadata = { title: "Dashboard · Brandy" };

export function load() {
  return { count: getCount(), loadedAt: new Date().toISOString() };
}

type DashboardData = ReturnType<typeof load>;

export default function Dashboard({ data }: { data: DashboardData }) {
  return (
    <section>
      <h1 class="text-3xl font-bold">Dashboard</h1>
      <p class="mt-2 text-zinc-400">
        The counter uses a server action. Only this page is replaced after submission.
      </p>

      <div class="mt-8 rounded border border-zinc-800 bg-zinc-900/30 p-5">
        <p class="text-sm text-zinc-500">Server-side count</p>
        <p class="mt-1 text-4xl font-bold">Count: {data.count}</p>
        <form class="mt-5" method="post" action={increment}>
          <button class="rounded bg-zinc-100 px-4 py-2 text-sm text-zinc-950">
            Increment on server
          </button>
        </form>
      </div>

      <p class="mt-4 text-xs text-zinc-500">
        Loader trace: <code>{data.loadedAt}</code>
      </p>
    </section>
  );
}

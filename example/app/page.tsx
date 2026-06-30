import { Html } from "@elysiajs/html";
import type { Metadata } from "brandy";

export const metadata: Metadata = { title: "Home · Brandy" };

export function load() {
  return {
    renderedAt: new Date().toLocaleTimeString("en-US"),
    requestId: crypto.randomUUID().slice(0, 8),
  };
}

type HomeData = ReturnType<typeof load>;

export default function Home({ data }: { data: HomeData }) {
  return (
    <main class="mx-auto max-w-4xl px-5 py-12">
      <h1 class="text-4xl font-bold">Brandy example</h1>
      <p class="mt-3 max-w-2xl text-zinc-400">
        A small example of server-rendered data, server actions, partial
        navigation, and Alpine client state.
      </p>

      <div class="mt-8 flex gap-3">
        <a
          class="rounded bg-zinc-100 px-4 py-2 text-sm text-zinc-950 no-underline"
          href="/dashboard"
        >
          Dashboard
        </a>
        <a
          class="rounded border border-zinc-700 px-4 py-2 text-sm no-underline"
          href="/about"
        >
          About
        </a>
      </div>

      <div class="mt-12 grid gap-6 md:grid-cols-2">
        <section class="rounded border border-zinc-800 bg-zinc-900/30 p-5">
          <p class="text-sm font-semibold">Server-side data</p>
          <dl class="mt-4 space-y-2 text-sm">
            <div class="flex justify-between gap-4">
              <dt class="text-zinc-500">Rendered at</dt>
              <dd class="font-mono">{data.renderedAt}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="text-zinc-500">Request ID</dt>
              <dd class="font-mono">{data.requestId}</dd>
            </div>
          </dl>
        </section>

        <section
          class="rounded border border-zinc-800 bg-zinc-900/30 p-5"
          x-data="{ count: 0, open: true }"
        >
          <div class="flex items-center justify-between">
            <p class="text-sm font-semibold">Client-side state</p>
            <button
              class="text-sm underline"
              x-on:click="open = !open"
            >
              Toggle
            </button>
          </div>
          <div
            class="mt-4 flex items-center gap-3"
            x-show="open"
            x-cloak=""
          >
            <button
              class="rounded bg-zinc-100 px-3 py-1.5 text-zinc-950"
              x-on:click="count++"
            >
              +
            </button>
            <span>
              Alpine count: <strong x-text="count">0</strong>
            </span>
          </div>
        </section>
      </div>
    </main>
  );
}

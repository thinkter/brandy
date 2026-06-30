import { Html } from "@elysiajs/html";

export default function AnalyticsLoading() {
  return (
    <section aria-busy="true">
      <h1 class="text-3xl font-bold">
        Analytics (Loader test with 4000ms delay)
      </h1>
      <p class="mt-2 text-zinc-400">Loading the report…</p>
      <div class="mt-8 h-32 animate-pulse rounded border border-zinc-800 bg-zinc-900/30" />
    </section>
  );
}

import { Html } from "@elysiajs/html";

export default function DashboardError({ error }: { error: unknown }) {
  return (
    <section class="rounded border border-red-900 bg-red-950/30 p-5" role="alert">
      <h1 class="text-2xl font-bold">Dashboard error</h1>
      <p class="mt-2 text-red-300">{error instanceof Error ? error.message : "Unknown error"}</p>
    </section>
  );
}

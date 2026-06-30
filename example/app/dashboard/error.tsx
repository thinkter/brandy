import { Html } from "@elysiajs/html";
import type { ErrorContext } from "brandy";

export default function DashboardError({ error, dev }: ErrorContext) {
  const message = dev && error instanceof Error ? error.message : "Something went wrong.";
  return (
    <section class="rounded border border-red-900 bg-red-950/30 p-5" role="alert">
      <h1 class="text-2xl font-bold">Dashboard error</h1>
      <p class="mt-2 text-red-300">{message}</p>
    </section>
  );
}

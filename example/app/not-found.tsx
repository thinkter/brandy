import { Html } from "@elysiajs/html";

export default function NotFound() {
  return (
    <main class="mx-auto max-w-4xl px-5 py-20 text-center">
      <h1 class="text-3xl font-bold">Not found</h1>
      <p class="mt-3 text-zinc-400">The requested page does not exist.</p>
    </main>
  );
}

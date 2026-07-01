import { Html } from "@elysiajs/html";
import type { Metadata } from "brandy";

export const metadata: Metadata = { title: "About · Brandy" };

// Static content, no per-request data — cache it forever until an action revalidates it.
export const prerender = true;

export default function About() {
  return (
    <main class="mx-auto max-w-4xl px-5 py-12">
      <h1 class="text-3xl font-bold">How it works</h1>
      <p class="mt-3 max-w-2xl text-zinc-400">
        Brandy compares the current and target layout chains, finds where they diverge, and replaces only that fragment.
      </p>

      <ol class="mt-8 list-decimal space-y-3 pl-5">
        <li>Match the URL to the filesystem route.</li>
        <li>Find the deepest shared layout.</li>
        <li>Render and swap only the changed segment.</li>
      </ol>
    </main>
  );
}

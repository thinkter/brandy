import { Html } from "@elysiajs/html";

export default function NotFoundRoute() {
  return (
    <main class="mx-auto max-w-4xl px-5 py-20 text-center">
      <p class="text-sm text-zinc-500">404</p>
      <h1 class="mt-2 text-3xl font-bold">Not found</h1>
      <p class="mt-3 text-zinc-400">This is the explicit 404 route.</p>
      <a class="mt-6 inline-block underline" href="/">
        Return home
      </a>
    </main>
  );
}

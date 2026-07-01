import { Html } from "@elysiajs/html";
import { Island } from "brandy";

export type HomeData = {
  renderedAt: string;
  requestId: string;
};

export function HomeHero() {
  return (
    <>
      <h1 class="text-4xl font-bold">Brandy example</h1>
      <p class="mt-3 max-w-2xl text-zinc-400">
        A small example of server-rendered data, server actions, partial
        navigation, and Alpine client state.
      </p>
    </>
  );
}

export function HomePrimaryLinks() {
  return (
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
  );
}

type FeatureLinkProps = {
  href: string;
  label: string;
  title: string;
  description: string;
};

function FeatureLink({ href, label, title, description }: FeatureLinkProps) {
  return (
    <a
      class="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 no-underline transition hover:border-zinc-600"
      href={href}
    >
      <span class="text-xs font-semibold uppercase tracking-wider text-amber-400">
        {label}
      </span>
      <strong class="mt-2 block text-lg">{title}</strong>
      <span class="mt-2 block text-sm leading-6 text-zinc-400">
        {description}
      </span>
    </a>
  );
}

export function HomeFeatureLinks() {
  return (
    <div class="mt-6 grid gap-4 sm:grid-cols-2">
      <FeatureLink
        href="/server"
        label="Server functions"
        title="Use filesystem and process APIs"
        description="Run async Node and Bun code in loaders without shipping it to the browser."
      />
      <FeatureLink
        href="/components"
        label="Components"
        title="Compose reusable server TSX"
        description="Share typed UI primitives and add Alpine only where interaction is needed."
      />
      <FeatureLink
        href="/interactive"
        label="Client only"
        title="Explore Alpine-powered UI patterns"
        description="Accordions, tabs, filters, toasts, and more without server data or hydration."
      />
    </div>
  );
}

export function HomeServerData({ data }: { data: HomeData }) {
  return (
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
  );
}

export function HomeClientState() {
  return (
    <Island>
      <section
        class="rounded border border-zinc-800 bg-zinc-900/30 p-5"
        x-data="{ count: 0, open: true }"
      >
        <div class="flex items-center justify-between">
          <p class="text-sm font-semibold">Client-side state</p>
          <button class="text-sm underline" x-on:click="open = !open">
            Toggle
          </button>
        </div>
        <div class="mt-4 flex items-center gap-3" x-show="open" x-cloak="">
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
    </Island>
  );
}

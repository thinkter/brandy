import { Html } from "@elysiajs/html";
import type { PropsWithChildren } from "@elysiajs/html";
import { Island, type Metadata } from "brandy";
import { Badge, Card, Code, PageHeader } from "../_components/ui.tsx";

export const metadata: Metadata = { title: "Interactive · Brandy" };

function Disclosure({ show, class: className = "", children }: PropsWithChildren<{
  show: string;
  class?: string;
}>) {
  return (
    <div
      class={className}
      x-show={show}
      x-transition:enter="transition ease-out duration-200"
      x-transition:enter-start="opacity-0 -translate-y-1"
      x-transition:enter-end="opacity-100 translate-y-0"
      x-transition:leave="transition ease-in duration-150"
      x-transition:leave-start="opacity-100 translate-y-0"
      x-transition:leave-end="opacity-0 -translate-y-1"
      x-cloak=""
    >
      {children}
    </div>
  );
}

const faqItems = [
  {
    id: "faq-1",
    title: "What makes this route client-only?",
    body: "The HTML is rendered once, then Alpine handles every interaction in-place. No loader data, no server round-trips, no component hydration.",
  },
  {
    id: "faq-2",
    title: "When should I use patterns like this?",
    body: "Use them for local state: disclosure UIs, tabs, menus, filters, sortable lists, toast notifications, and temporary UI preferences.",
  },
  {
    id: "faq-3",
    title: "What should stay on the server instead?",
    body: "Fetching data, mutating records, auth checks, and anything that must remain trusted or consistent across sessions.",
  },
];

const tabs = [
  { id: "overview", body: "Alpine owns ephemeral state well: show or hide UI, keep small counters, hold open panels, and drive filters over static data already in the page." },
  { id: "patterns", body: <>Combine <Code>x-data</Code>, <Code>x-show</Code>, <Code>x-on</Code>, <Code>x-bind</Code>, and <Code>x-for</Code> to build useful islands without turning the whole page into a client app.</> },
  { id: "tradeoffs", body: "This works best when state is local and disposable. Once UI depends on shared server truth, move the source of truth back to loaders or actions." },
];

const filters = ["all", "design", "product", "engineering"];

const gallery = [
  { name: "Studio", category: "design", accent: "from-fuchsia-500/20 to-pink-500/10" },
  { name: "Pulse", category: "product", accent: "from-cyan-500/20 to-sky-500/10" },
  { name: "Orbit", category: "engineering", accent: "from-emerald-500/20 to-green-500/10" },
  { name: "North", category: "design", accent: "from-amber-500/20 to-yellow-500/10" },
  { name: "Signal", category: "product", accent: "from-violet-500/20 to-purple-500/10" },
  { name: "Atlas", category: "engineering", accent: "from-rose-500/20 to-orange-500/10" },
];

export default function InteractivePage() {
  return (
    <Island>
    <main
      class="mx-auto max-w-6xl px-6 py-16 sm:px-8 lg:px-10 lg:py-20"
      x-data="{
        tab: 'overview',
        openFaq: 'faq-1',
        filter: 'all',
        liked: ['Studio', 'Orbit'],
        toast: '',
        toastTimer: null,
        commandOpen: false,
        notify(message) {
          this.toast = message;
          clearTimeout(this.toastTimer);
          this.toastTimer = setTimeout(() => this.toast = '', 2200);
        },
      }"
      x-init="window.addEventListener('keydown', (event) => { if (event.key === '/') { event.preventDefault(); commandOpen = true } if (event.key === 'Escape') { commandOpen = false } })"
    >
      <div class="relative isolate overflow-hidden rounded-[2rem] border border-zinc-800/80 bg-zinc-900/30 px-7 py-10 shadow-[0_30px_80px_rgba(0,0,0,0.35)] sm:px-10 sm:py-12">
        <div class="animate-branded-glow absolute -top-20 right-0 h-56 w-56 rounded-full bg-amber-500/10 blur-3xl"></div>
        <div class="animate-branded-float absolute -left-16 top-24 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl"></div>

        <PageHeader
          eyebrow="Client-side route"
          title="Interactive UI patterns without hydration"
          description="This page is intentionally all local state. Every panel here runs entirely in the browser with Alpine on top of plain server-rendered HTML."
        />

        <div class="mt-8 flex flex-wrap items-center gap-3.5 text-sm text-zinc-400">
          <Badge tone="success">Client only</Badge>
          <span>No loaders</span>
          <span>•</span>
          <span>No actions</span>
          <span>•</span>
          <span>Press <Code>/</Code> to open the command panel</span>
        </div>

        <div class="mt-12 grid gap-8 xl:grid-cols-[1.2fr_0.8fr] xl:gap-10">
          <div class="space-y-8">
            <Card title="Accordion">
              <div class="space-y-4">
                {faqItems.map((item) => (
                  <section class="rounded-xl border border-zinc-800 bg-zinc-950/40 transition duration-200 hover:border-zinc-700">
                    <button
                      class="flex w-full items-center justify-between gap-6 px-5 py-4 text-left"
                      x-on:click={`openFaq = openFaq === '${item.id}' ? '' : '${item.id}'`}
                      x-bind:aria-expanded={`openFaq === '${item.id}'`}
                    >
                      <span class="font-medium text-zinc-100">{item.title}</span>
                      <span
                        class="text-lg text-zinc-500 transition-transform duration-200"
                        x-bind:class={`openFaq === '${item.id}' ? 'rotate-45' : ''`}
                      >
                        +
                      </span>
                    </button>
                    <Disclosure show={`openFaq === '${item.id}'`} class="px-5 pb-5 text-sm leading-7 text-zinc-400">
                      {item.body}
                    </Disclosure>
                  </section>
                ))}
              </div>
            </Card>

            <Card title="Tabs">
              <div class="flex flex-wrap gap-3">
                {tabs.map(({ id }) => (
                  <button
                    class="rounded-lg border border-zinc-800 px-4 py-2.5 text-sm transition duration-200 hover:border-zinc-600"
                    x-on:click={`tab = '${id}'`}
                    x-bind:class={`tab === '${id}' ? 'border-zinc-100 bg-zinc-100 text-zinc-950' : 'text-zinc-400'`}
                  >
                    {id[0].toUpperCase() + id.slice(1)}
                  </button>
                ))}
              </div>

              <div class="mt-6 min-h-28 space-y-4 text-sm leading-7 text-zinc-400">
                {tabs.map(({ id, body }) => (
                  <Disclosure show={`tab === '${id}'`}>{body}</Disclosure>
                ))}
              </div>
            </Card>

            <Card title="Filterable gallery">
              <div class="flex flex-wrap items-center gap-3">
                {filters.map((option) => (
                  <button
                    class="rounded-full border border-zinc-800 px-3.5 py-2 text-sm transition duration-200 hover:border-zinc-600"
                    x-on:click={`filter = '${option}'`}
                    x-bind:class={`filter === '${option}' ? 'border-amber-400 text-amber-300' : 'text-zinc-400'`}
                  >
                    {option}
                  </button>
                ))}
              </div>

              <div class="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {gallery.map((item) => (
                  <article
                    class="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5 transition duration-300 hover:-translate-y-1 hover:border-zinc-700 hover:bg-zinc-900/60"
                    x-show={`filter === 'all' || filter === '${item.category}'`}
                    x-cloak=""
                  >
                    <div class={`h-28 rounded-xl bg-gradient-to-br ${item.accent}`}></div>
                    <div class="mt-5 flex items-start justify-between gap-4">
                      <div>
                        <h3 class="text-base font-medium text-zinc-100">{item.name}</h3>
                        <p class="mt-2 text-xs uppercase tracking-[0.18em] text-zinc-500">{item.category}</p>
                      </div>
                      <button
                        class="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 transition duration-200 hover:border-zinc-600"
                        x-on:click={`liked.includes('${item.name}') ? (liked = liked.filter((entry) => entry !== '${item.name}'), notify('${item.name} removed from favorites')) : (liked = [...liked, '${item.name}'], notify('${item.name} added to favorites'))`}
                        x-bind:class={`liked.includes('${item.name}') ? 'border-amber-400 text-amber-300' : ''`}
                      >
                        <span x-text={`liked.includes('${item.name}') ? 'Liked' : 'Like'`}>Like</span>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </Card>
          </div>

          <div class="space-y-8">
            <Card title="Quick actions">
              <div class="space-y-4 text-sm text-zinc-400">
                <button
                  class="flex w-full items-center justify-between rounded-xl border border-zinc-800 px-5 py-4 text-left transition duration-200 hover:border-zinc-700 hover:bg-zinc-950/60"
                  x-on:click="commandOpen = true"
                >
                  <span>Open command panel</span>
                  <Code>/</Code>
                </button>
                <button
                  class="w-full rounded-xl border border-zinc-800 px-5 py-4 text-left transition duration-200 hover:border-zinc-700 hover:bg-zinc-950/60"
                  x-on:click="notify('Saved local UI preferences')"
                >
                  Trigger toast
                </button>
              </div>
            </Card>

            <Card title="Live state">
              <dl class="space-y-3 text-sm">
                <div class="flex justify-between gap-4">
                  <dt class="text-zinc-500">Active tab</dt>
                  <dd class="font-mono" x-text="tab">overview</dd>
                </div>
                <div class="flex justify-between gap-4">
                  <dt class="text-zinc-500">Open accordion</dt>
                  <dd class="font-mono" x-text="openFaq || 'none'">faq-1</dd>
                </div>
                <div class="flex justify-between gap-4">
                  <dt class="text-zinc-500">Filter</dt>
                  <dd class="font-mono" x-text="filter">all</dd>
                </div>
                <div class="flex justify-between gap-4">
                  <dt class="text-zinc-500">Favorites</dt>
                  <dd class="font-mono" x-text="liked.join(', ')">Studio, Orbit</dd>
                </div>
              </dl>
            </Card>

            <Card title="Why this route exists">
              <p class="text-sm leading-7 text-zinc-400">
                The other example pages mix server rendering with selective interactivity. This route isolates the browser-only part so people can evaluate Alpine patterns on their own.
              </p>
            </Card>
          </div>
        </div>
      </div>

      <div
        class="pointer-events-none fixed right-6 bottom-6 z-20 rounded-xl border border-emerald-800 bg-emerald-950/95 px-4 py-3 text-sm text-emerald-200 shadow-2xl"
        x-show="toast"
        x-transition:enter="transition ease-out duration-250"
        x-transition:enter-start="opacity-0 translate-y-3"
        x-transition:enter-end="opacity-100 translate-y-0"
        x-transition:leave="transition ease-in duration-200"
        x-transition:leave-start="opacity-100 translate-y-0"
        x-transition:leave-end="opacity-0 translate-y-3"
        x-cloak=""
      >
        <span x-text="toast">Saved local UI preferences</span>
      </div>

      <div
        class="fixed inset-0 z-30 flex items-start justify-center bg-black/60 px-5 pt-24"
        x-show="commandOpen"
        x-transition:enter="transition ease-out duration-200"
        x-transition:enter-start="opacity-0"
        x-transition:enter-end="opacity-100"
        x-transition:leave="transition ease-in duration-150"
        x-transition:leave-start="opacity-100"
        x-transition:leave-end="opacity-0"
        x-cloak=""
      >
        <div
          class="w-full max-w-xl rounded-[1.5rem] border border-zinc-800 bg-zinc-950 shadow-2xl"
          x-transition:enter="transition ease-out duration-200 delay-75"
          x-transition:enter-start="opacity-0 translate-y-4 scale-[0.98]"
          x-transition:enter-end="opacity-100 translate-y-0 scale-100"
          x-transition:leave="transition ease-in duration-150"
          x-transition:leave-start="opacity-100 translate-y-0 scale-100"
          x-transition:leave-end="opacity-0 translate-y-3 scale-[0.98]"
        >
          <div class="border-b border-zinc-800 px-4 py-3 text-sm text-zinc-400">
            Mock command panel
          </div>
          <div class="p-4">
            <button
              class="flex w-full items-center justify-between rounded-xl px-4 py-3.5 text-left transition duration-200 hover:bg-zinc-900"
              x-on:click="tab = 'overview'; commandOpen = false; notify('Jumped to overview tab')"
            >
              <span>Go to overview tab</span>
              <span class="text-xs text-zinc-500">state change</span>
            </button>
            <button
              class="mt-2 flex w-full items-center justify-between rounded-xl px-4 py-3.5 text-left transition duration-200 hover:bg-zinc-900"
              x-on:click="filter = 'engineering'; commandOpen = false; notify('Filtered to engineering')"
            >
              <span>Show engineering cards</span>
              <span class="text-xs text-zinc-500">filter</span>
            </button>
            <button
              class="mt-2 flex w-full items-center justify-between rounded-xl px-4 py-3.5 text-left transition duration-200 hover:bg-zinc-900"
              x-on:click="openFaq = 'faq-3'; commandOpen = false; notify('Opened server tradeoff answer')"
            >
              <span>Open tradeoffs FAQ</span>
              <span class="text-xs text-zinc-500">accordion</span>
            </button>
          </div>
        </div>
      </div>
    </main>
    </Island>
  );
}

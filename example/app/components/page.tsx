import { Html } from "@elysiajs/html";
import type { Metadata } from "brandy";
import { Badge, Card, Code, PageHeader, Stat } from "../_components/ui.tsx";

export const metadata: Metadata = { title: "Components · Brandy" };

const features = [
  { title: "Plain functions", detail: "Components execute on the server and return HTML strings." },
  { title: "Typed props", detail: "Use TypeScript interfaces without a client bundle or hydration." },
  { title: "Composable", detail: "Children can contain native tags, components, or async route output." },
];

export default function ComponentsPage() {
  return (
    <main class="mx-auto max-w-4xl px-5 py-12" x-data="{ tab: 'components' }">
      <PageHeader
        eyebrow="Component system"
        title="Reusable server-rendered TSX"
        description="Build a shared visual language with ordinary functions, typed props, and children. Alpine can add small interactive islands without hydrating the component tree."
      />

      <div class="mt-10 flex gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-1">
        <button class="rounded-md px-4 py-2 text-sm" x-on:click="tab = 'components'" x-bind:class="tab === 'components' ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400'">Components</button>
        <button class="rounded-md px-4 py-2 text-sm" x-on:click="tab = 'composition'" x-bind:class="tab === 'composition' ? 'bg-zinc-100 text-zinc-950' : 'text-zinc-400'">Composition</button>
      </div>

      <div class="mt-6 grid gap-4 md:grid-cols-3" x-show="tab === 'components'" x-cloak="">
        {features.map((feature, index) => (
          <Card title={feature.title}>
            <p class="text-sm leading-6 text-zinc-400">{feature.detail}</p>
            <div class="mt-5"><Badge tone={index === 1 ? "success" : "neutral"}>Server component</Badge></div>
          </Card>
        ))}
      </div>

      <div class="mt-6" x-show="tab === 'composition'" x-cloak="">
        <Card title="A composed component tree">
          <div class="grid gap-6 sm:grid-cols-3">
            <Stat label="JavaScript sent" value="0 KB" detail="for the TSX components" />
            <Stat label="Hydration" value="None" detail="HTML is immediately usable" />
            <Stat label="Interactivity" value="Alpine" detail="only where requested" />
          </div>
          <p class="mt-6 border-t border-zinc-800 pt-5 text-sm text-zinc-400">
            This panel composes <Code>Card</Code>, <Code>Stat</Code>, and <Code>Code</Code> while Alpine controls only its visibility.
          </p>
        </Card>
      </div>
    </main>
  );
}

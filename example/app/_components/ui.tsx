import { Html } from "@elysiajs/html";
import type { PropsWithChildren } from "@elysiajs/html";

export function PageHeader({ eyebrow, title, description }: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header class="max-w-2xl">
      <p class="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">{eyebrow}</p>
      <h1 class="mt-3 text-4xl font-bold tracking-tight">{title}</h1>
      <p class="mt-4 text-lg leading-8 text-zinc-400">{description}</p>
    </header>
  );
}

export function Card({ title, children, class: className = "" }: PropsWithChildren<{
  title?: string;
  class?: string;
}>) {
  return (
    <section class={`rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 ${className}`}>
      {title ? <h2 class="mb-4 text-sm font-semibold text-zinc-200">{title}</h2> : ""}
      {children}
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: PropsWithChildren<{
  tone?: "neutral" | "success" | "warning";
}>) {
  const colors = {
    neutral: "border-zinc-700 bg-zinc-800 text-zinc-300",
    success: "border-emerald-900 bg-emerald-950 text-emerald-300",
    warning: "border-amber-900 bg-amber-950 text-amber-300",
  };
  return <span class={`inline-flex rounded-full border px-2.5 py-1 text-xs ${colors[tone]}`}>{children}</span>;
}

export function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <dt class="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd class="mt-2 font-mono text-xl font-semibold text-zinc-100">{value}</dd>
      {detail ? <p class="mt-1 text-xs text-zinc-500">{detail}</p> : ""}
    </div>
  );
}

export function Code({ children }: PropsWithChildren) {
  return <code class="rounded bg-zinc-950 px-1.5 py-0.5 font-mono text-sm text-amber-300">{children}</code>;
}

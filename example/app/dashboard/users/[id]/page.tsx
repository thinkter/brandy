import { Html } from "@elysiajs/html";
import { notFound, type Metadata } from "brandy";

// Cache per-[id] output for 10s at a time — exercises the dynamic-param, lazy-populate path.
export const revalidate = 10;

export function load({ params }: { params: Record<string, string> }) {
  if (params.id === "missing") notFound();
  if (params.id === "error") throw new Error("User loader failed");
  return {
    id: params.id,
    name: params.id === "42" ? "Ada Lovelace" : `User ${params.id}`,
    role: params.id === "42" ? "Framework engineer" : "Brandy explorer",
  };
}

type UserData = ReturnType<typeof load>;

export function metadata({ data }: { data: UserData }): Metadata {
  return { title: `User ${data.id} · Brandy` };
}

export default function UserPage({ data }: { data: UserData }) {
  return (
    <section>
      <h1 class="text-3xl font-bold">User {data.id}</h1>
      <p class="mt-2 text-zinc-400">This profile was loaded from the dynamic <code>[id]</code> segment.</p>

      <article class="mt-8 flex items-center gap-4 rounded border border-zinc-800 bg-zinc-900/30 p-5">
        <div class="grid size-12 shrink-0 place-items-center rounded bg-zinc-800 text-lg font-semibold">
          {data.name.charAt(0)}
        </div>
        <div>
          <h2 class="font-semibold">{data.name}</h2>
          <p class="text-sm text-zinc-400">{data.role}</p>
          <p class="mt-2 font-mono text-xs text-zinc-500">params.id = &quot;{data.id}&quot;</p>
        </div>
      </article>
    </section>
  );
}

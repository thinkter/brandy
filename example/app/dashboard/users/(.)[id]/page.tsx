import { Html } from "@elysiajs/html";
import type { Metadata } from "brandy";

export function load({ params }: { params: Record<string, string> }) {
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

export default function UserModal({ data }: { data: UserData }) {
  return (
    <div class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <article class="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl">
        <div class="flex items-center gap-4">
          <div class="grid size-12 shrink-0 place-items-center rounded bg-zinc-800 text-lg font-semibold">
            {data.name.charAt(0)}
          </div>
          <div>
            <h2 class="font-semibold">{data.name}</h2>
            <p class="text-sm text-zinc-400">{data.role}</p>
          </div>
        </div>
        <p class="mt-4 text-xs text-zinc-500">
          This is the intercepted modal — same route, rendered over the list via a{" "}
          <code>(.)[id]</code> marker directory.
        </p>
        <div class="mt-5 flex justify-end gap-3 text-sm">
          <a class="underline" href="/dashboard/users">Close</a>
          <a class="underline" href={`/dashboard/users/${data.id}`} data-brandy-no-intercept>
            Open full page
          </a>
        </div>
      </article>
    </div>
  );
}

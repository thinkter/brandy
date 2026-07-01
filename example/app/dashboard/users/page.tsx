import { Html } from "@elysiajs/html";
import type { Metadata } from "brandy";

export const metadata: Metadata = { title: "Users · Brandy" };

const USERS = ["1", "2", "42"];

export default function UsersList() {
  return (
    <section>
      <h1 class="text-3xl font-bold">Users</h1>
      <p class="mt-2 text-zinc-400">
        Clicking a name intercepts <code>/dashboard/users/[id]</code> as a modal over this list.
        "Open full page" forces the standalone page via <code>data-brandy-no-intercept</code>,
        and a hard reload of a profile URL always renders standalone too.
      </p>

      <ul class="mt-8 divide-y divide-zinc-800 rounded border border-zinc-800 bg-zinc-900/30">
        {USERS.map((id) => (
          <li class="flex items-center justify-between p-4">
            <a href={`/dashboard/users/${id}`}>User {id}</a>
            <a class="text-xs text-zinc-500 underline" href={`/dashboard/users/${id}`} data-brandy-no-intercept>
              Open full page
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

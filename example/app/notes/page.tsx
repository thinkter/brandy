import { Html } from "@elysiajs/html";
import { desc, eq } from "drizzle-orm";
import type { Metadata, RequestContext } from "brandy";
import { Badge, Card, Code, PageHeader } from "../_components/ui.tsx";
import { currentUser } from "../_lib/auth.ts";
import { db } from "../_lib/db.ts";
import { note } from "../_lib/schema.ts";
import { addNote, deleteNote, signIn, signOut, signUp } from "./actions.ts";

export const metadata: Metadata = {
  title: "Notes · Brandy",
  meta: { description: "Better Auth sessions and Drizzle queries behind Brandy server actions" },
};

export async function load({ request, url }: RequestContext) {
  const user = await currentUser(request);
  const error = url.searchParams.get("error");
  if (!user) return { user: null, notes: [], error };
  const rows = await db
    .select({ id: note.id, text: note.text, createdAt: note.createdAt })
    .from(note)
    .where(eq(note.userId, user.id))
    .orderBy(desc(note.createdAt));
  return { user, notes: rows, error };
}

type Data = Awaited<ReturnType<typeof load>>;

const input =
  "w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500";
const button =
  "rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500";

function SignedOut({ error }: { error: string | null }) {
  return (
    <div class="mt-10">
      {error && (
        <p role="alert" class="mb-6 rounded-md border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}
      <div class="grid gap-6 sm:grid-cols-2">
        <Card title="Sign in">
          <form method="post" action={signIn} class="space-y-3">
            <input class={input} type="email" name="email" placeholder="Email" required />
            <input class={input} type="password" name="password" placeholder="Password" required />
            <button class={button}>Sign in</button>
          </form>
        </Card>
        <Card title="Create an account">
          <form method="post" action={signUp} class="space-y-3">
            <input class={input} type="text" name="name" placeholder="Name" required />
            <input class={input} type="email" name="email" placeholder="Email" required />
            <input class={input} type="password" name="password" placeholder="Password (min 8 chars)" required />
            <button class={button}>Sign up</button>
          </form>
        </Card>
      </div>
      <p class="mt-6 text-sm leading-6 text-zinc-500">
        Both forms post to Brandy server actions that call Better Auth's server API and forward its
        session cookies on a <Code>303</Code> redirect. Without JavaScript they work as ordinary form
        posts; with JavaScript the redirect is followed as a fragment navigation.
      </p>
    </div>
  );
}

function SignedIn({ data }: { data: Data }) {
  return (
    <div class="mt-10 space-y-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Badge tone="success">Signed in</Badge>
          <span class="text-sm text-zinc-400">
            {data.user!.name} · {data.user!.email}
          </span>
        </div>
        <form method="post" action={signOut}>
          <button class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
            Sign out
          </button>
        </form>
      </div>

      {data.error && (
        <p role="alert" class="rounded-md border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          {data.error}
        </p>
      )}

      <Card title="Add a note">
        <form method="post" action={addNote} class="flex gap-3">
          <input class={input} type="text" name="text" placeholder="Stored in Postgres via Drizzle" required />
          <button class={button}>Add</button>
        </form>
      </Card>

      <Card title={`Your notes (${data.notes.length})`}>
        {data.notes.length === 0 ? (
          <p class="text-sm text-zinc-500">Nothing yet. Notes are scoped to your account.</p>
        ) : (
          <ul class="divide-y divide-zinc-800">
            {data.notes.map((item) => (
              <li class="flex items-center justify-between gap-4 py-3">
                <div>
                  <p class="text-sm text-zinc-200">{item.text}</p>
                  <p class="mt-1 text-xs text-zinc-500">{item.createdAt.toISOString()}</p>
                </div>
                <form method="post" action={deleteNote}>
                  <input type="hidden" name="id" value={item.id} />
                  <button class="text-sm text-red-400 hover:text-red-300">Delete</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p class="text-sm leading-6 text-zinc-500">
        <Code>addNote</Code> and <Code>deleteNote</Code> return <Code>revalidate("/notes")</Code>, so the
        loader re-queries Postgres and only this route's fragment is re-rendered and swapped.
      </p>
    </div>
  );
}

export default function NotesPage({ data }: { data: Data }) {
  return (
    <main class="mx-auto max-w-4xl px-5 py-12">
      <PageHeader
        eyebrow="Auth + database"
        title="Sessions and rows, no client framework"
        description="Better Auth issues the session, Drizzle reads and writes Neon Postgres, and every mutation is a plain form posting to a Brandy server action."
      />
      {data.user ? <SignedIn data={data} /> : <SignedOut error={data.error} />}
    </main>
  );
}

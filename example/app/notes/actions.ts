import { defineAction, revalidate } from "brandy";
import { and, eq } from "drizzle-orm";
import { auth, currentUser } from "../_lib/auth.ts";
import { db } from "../_lib/db.ts";
import { note } from "../_lib/schema.ts";

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** 303 back to /notes, optionally carrying a user-facing error in the query string. */
function back(request: Request, error?: string): Response {
  const location = new URL("/notes", request.url);
  if (error) location.searchParams.set("error", error);
  return new Response(null, { status: 303, headers: { location: location.href } });
}

/** Converts a Better Auth response into the redirect, forwarding its session cookies. */
async function completeAuth(request: Request, result: Response): Promise<Response> {
  if (!result.ok) {
    let message = "Authentication failed";
    try {
      message = ((await result.json()) as { message?: string }).message ?? message;
    } catch {}
    return back(request, message);
  }
  const redirect = back(request);
  for (const cookie of result.headers.getSetCookie()) redirect.headers.append("set-cookie", cookie);
  return redirect;
}

export const signUp = defineAction(async function signUp(form, { request }) {
  const name = field(form, "name");
  const email = field(form, "email");
  const password = field(form, "password");
  if (!name || !email || !password) return back(request, "Name, email, and password are required");
  const result = await auth.api.signUpEmail({
    body: { name, email, password },
    headers: request.headers,
    asResponse: true,
  });
  return completeAuth(request, result);
});

export const signIn = defineAction(async function signIn(form, { request }) {
  const email = field(form, "email");
  const password = field(form, "password");
  if (!email || !password) return back(request, "Email and password are required");
  const result = await auth.api.signInEmail({
    body: { email, password },
    headers: request.headers,
    asResponse: true,
  });
  return completeAuth(request, result);
});

export const signOut = defineAction(async function signOut(_form, { request }) {
  const result = await auth.api.signOut({ headers: request.headers, asResponse: true });
  return completeAuth(request, result);
});

export const addNote = defineAction(async function addNote(form, { request }) {
  const user = await currentUser(request);
  if (!user) return back(request, "Sign in to add notes");
  const text = field(form, "text");
  if (!text) return back(request, "Write something first");
  await db.insert(note).values({ text, userId: user.id });
  return revalidate("/notes");
});

export const deleteNote = defineAction(async function deleteNote(form, { request }) {
  const user = await currentUser(request);
  if (!user) return back(request, "Sign in first");
  const id = field(form, "id");
  if (!id) return back(request, "Missing note id");
  await db.delete(note).where(and(eq(note.id, id), eq(note.userId, user.id)));
  return revalidate("/notes");
});

import type { ActionHandler, Revalidation, ServerAction } from "./types.ts";

export class NotFoundError extends Error {
  constructor() { super("Not found"); this.name = "NotFoundError"; }
}

export function notFound(): never {
  throw new NotFoundError();
}

export class RedirectError extends Error {
  readonly response: Response;
  constructor(response: Response) {
    super(`Redirect to ${response.headers.get("location") ?? "(unknown)"}`);
    this.name = "RedirectError";
    this.response = response;
  }
}

/**
 * Redirect from a loader. Throw this inside a `load()` function to send the
 * browser (or the client runtime on soft navigation) to another URL.
 *
 * On cold loads the server responds with the redirect status and Location header
 * directly. On client-side fragment navigations the runtime performs a
 * `location.assign()` so the full page is replaced at the new URL.
 *
 * @param url  Destination URL — absolute, or relative to the server root.
 * @param status HTTP status code, defaults to 302 (temporary redirect).
 */
export function redirect(url: string, status: 301 | 302 | 303 | 307 | 308 = 302): never {
  throw new RedirectError(new Response(null, { status, headers: { location: url } }));
}

export function revalidate(path: string): Revalidation {
  return Object.freeze({ kind: "brandy-revalidate", path });
}

export function isRevalidation(value: unknown): value is Revalidation {
  return typeof value === "object" && value !== null && (value as Revalidation).kind === "brandy-revalidate";
}

export function defineAction<T extends ActionHandler>(handler: T): T & ServerAction {
  return handler as T & ServerAction;
}

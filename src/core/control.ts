import type { ActionHandler, Revalidation, ServerAction } from "./types.ts";

export class NotFoundError extends Error {
  constructor() { super("Not found"); this.name = "NotFoundError"; }
}

export function notFound(): never {
  throw new NotFoundError();
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

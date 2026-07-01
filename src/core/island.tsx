import { Html } from "@elysiajs/html";
import type { PropsWithChildren } from "@elysiajs/html";

/** Explicit client boundary: marks a subtree so the nav runtime knows to lazily fetch Alpine.
 * Content outside an Island never triggers a request for the Alpine chunk. */
export function Island({ children }: PropsWithChildren): JSX.Element {
  return <div data-brandy-island>{children}</div>;
}

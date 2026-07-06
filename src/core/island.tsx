import { Html } from "@elysiajs/html";
import type { PropsWithChildren } from "@elysiajs/html";

export type IslandProps = PropsWithChildren<{
  /** HTML element used for the island boundary. Defaults to `div`. */
  tag?: keyof JSX.IntrinsicElements;
}>;

/** Explicit client boundary: marks a subtree so the nav runtime knows to lazily fetch Alpine.
 * Content outside an Island never triggers a request for the Alpine chunk. */
export function Island({ children, tag = "div" }: IslandProps): JSX.Element {
  return Html.createElement(tag, { "data-brandy-island": true }, children);
}

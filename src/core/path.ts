/** Normalizes a pathname for route matching. Operates on the raw (still
 * percent-encoded) pathname — it must never decode. Decoding a param segment
 * is `paramsFor`'s job (see src/core/diff.ts), and it happens exactly once,
 * there, so that route matching sees the same bytes for every request and a
 * value like `%2541` can't sneak past a filter by being decoded twice. */
export function normalizePathname(input: string): string {
  const pathname = new URL(input, "http://brandy.local").pathname;
  const collapsed = pathname.replace(/\/{2,}/g, "/");
  if (collapsed === "/") return "/";
  return collapsed.replace(/\/+$/, "") || "/";
}

export function routePattern(segments: string[]): string {
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

export function slotId(layoutId: string): string {
  const suffix = layoutId === "root"
    ? "root"
    : layoutId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `brandy-slot-${suffix}`;
}

export function streamId(nodeId: string): string {
  const suffix = nodeId === "root" ? "root" : nodeId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `brandy-stream-${suffix}`;
}

export function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

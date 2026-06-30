export function normalizePathname(input: string): string {
  const pathname = new URL(input, "http://brandy.local").pathname;
  const decoded = decodeURI(pathname).replace(/\/{2,}/g, "/");
  if (decoded === "/") return "/";
  return decoded.replace(/\/+$/, "") || "/";
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

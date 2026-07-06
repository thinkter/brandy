const STREAM_BOUNDARY = "<!--brandy:stream-boundary-->";

/** Splits a buffered stream on the sentinel comment the server emits between the skeleton and the
 * deferred real content. Returns null until the full sentinel has arrived in the buffer. */
export function splitStream(buffer: string): { skeleton: string; rest: string } | null {
  const index = buffer.indexOf(STREAM_BOUNDARY);
  if (index === -1) return null;
  return { skeleton: buffer.slice(0, index), rest: buffer.slice(index + STREAM_BOUNDARY.length) };
}

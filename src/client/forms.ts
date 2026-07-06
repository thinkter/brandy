export function getFormSearchParams(data: FormData): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of data) {
    if (typeof value !== "string") {
      throw new TypeError("Brandy cannot intercept a GET form containing files. Use method=\"post\" or add data-brandy-reload for native submission.");
    }
    query.append(key, value);
  }
  return query;
}

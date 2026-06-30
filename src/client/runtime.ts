declare global {
  interface Window { Brandy?: { reinit?: (root: Element) => void } }
}

const PARTIAL = "x-brandy-navigation";
const CURRENT = "x-brandy-current-url";

function internal(url: URL): boolean {
  return url.origin === location.origin;
}

async function navigate(url: URL, init?: RequestInit, push = true): Promise<void> {
  const response = await fetch(url, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init?.headers)), [PARTIAL]: "1", [CURRENT]: location.pathname + location.search },
  });
  if (!response.ok) {
    location.assign(url);
    return;
  }
  const selector = response.headers.get("x-brandy-retarget");
  const mode = response.headers.get("x-brandy-reswap");
  const target = selector && document.querySelector(selector);
  if (!target || mode !== "innerHTML") {
    location.assign(url);
    return;
  }
  target.innerHTML = await response.text();
  if (push) history.pushState({}, "", url);
  window.Brandy?.reinit?.(target);
}

document.addEventListener("click", (event) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
  if (!link || link.target || link.download || link.hasAttribute("data-brandy-reload")) return;
  const url = new URL(link.href, location.href);
  if (!internal(url)) return;
  event.preventDefault();
  void navigate(url);
});

document.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  if (!(form instanceof HTMLFormElement) || form.hasAttribute("data-brandy-reload")) return;
  const url = new URL(form.action || location.href, location.href);
  if (!internal(url)) return;
  event.preventDefault();
  const method = form.method.toUpperCase();
  const data = new FormData(form, event.submitter as HTMLElement | null ?? undefined);
  if (method === "GET") {
    url.search = new URLSearchParams(data as unknown as Record<string, string>).toString();
    void navigate(url);
  } else {
    void navigate(url, { method, body: data });
  }
});

export {};

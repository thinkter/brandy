declare global {
  interface Window {
    Brandy?: { reinit?: (root: Element) => void };
  }
}

const PARTIAL = "x-brandy-navigation";
const CURRENT = "x-brandy-current-url";
const PREFETCH = "x-brandy-prefetch";
const HOVER_DELAY = 100;

let renderedURL = location.pathname + location.search;

interface FragmentResult {
  html: string;
  retarget: string | null;
  reswap: string | null;
  finalURL: string | null;
  status: number;
}

interface PrefetchEntry {
  promise: Promise<FragmentResult>;
  currentURL: string;
}

const prefetchCache = new Map<string, PrefetchEntry>();
let armedLink: HTMLAnchorElement | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;

function internal(url: URL): boolean { return url.origin === location.origin; }

function cacheKey(url: URL): string { return url.pathname + url.search; }

function reconcileHead(fragment: DocumentFragment): void {
  const update = fragment.querySelector<HTMLTemplateElement>("template[data-brandy-head]");
  if (!update) return;
  document.head.querySelectorAll("[data-brandy-metadata]").forEach((node) => node.remove());
  document.head.append(update.content.cloneNode(true));
  update.remove();
}

function reinitialize(root: Element): void {
  window.Brandy?.reinit?.(root);
}

async function fetchFragment(url: URL, init?: RequestInit, prefetch = false): Promise<FragmentResult> {
  const headers: Record<string, string> = {
    ...Object.fromEntries(new Headers(init?.headers)),
    [PARTIAL]: "1",
    [CURRENT]: renderedURL,
  };
  if (prefetch) headers[PREFETCH] = "1";
  const response = await fetch(url, { ...init, headers });
  return {
    html: await response.text(),
    retarget: response.headers.get("x-brandy-retarget"),
    reswap: response.headers.get("x-brandy-reswap"),
    finalURL: response.headers.get("x-brandy-url"),
    status: response.status,
  };
}

function applyFragment(result: FragmentResult, url: URL, historyMode: "push" | "none"): void {
  prefetchCache.clear();
  disarmPrefetch();
  const target = result.retarget && document.querySelector(result.retarget);
  if (!target || result.reswap !== "innerHTML") {
    location.assign(result.finalURL ?? url.href);
    return;
  }
  const template = document.createElement("template");
  template.innerHTML = result.html;
  reconcileHead(template.content);
  target.replaceChildren(template.content.cloneNode(true));
  const finalURL = result.finalURL ?? `${url.pathname}${url.search}`;
  if (historyMode === "push" || finalURL !== renderedURL && url.pathname.startsWith("/_brandy/actions/")) {
    history.pushState({}, "", finalURL);
  }
  renderedURL = finalURL;
  reinitialize(target);
}

async function navigate(url: URL, init?: RequestInit, historyMode: "push" | "none" = "push"): Promise<void> {
  const key = cacheKey(url);
  const cached = !init ? prefetchCache.get(key) : undefined;
  if (cached && cached.currentURL === renderedURL) {
    prefetchCache.delete(key);
    try {
      applyFragment(await cached.promise, url, historyMode);
    } catch {
      location.assign(url);
    }
    return;
  }
  let result: FragmentResult;
  try {
    result = await fetchFragment(url, init);
  } catch {
    location.assign(url);
    return;
  }
  applyFragment(result, url, historyMode);
}

function eligibleForPrefetch(link: HTMLAnchorElement): URL | null {
  if (link.target || link.download || link.hasAttribute("data-brandy-reload") || link.hasAttribute("data-brandy-no-prefetch")) return null;
  const url = new URL(link.href, location.href);
  if (!internal(url)) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return url;
}

function prefetch(url: URL): void {
  const key = cacheKey(url);
  if (prefetchCache.has(key)) return;
  const promise = fetchFragment(url, undefined, true);
  prefetchCache.set(key, { promise, currentURL: renderedURL });
  promise.catch(() => prefetchCache.delete(key));
}

function disarmPrefetch(): void {
  clearTimeout(hoverTimer);
  hoverTimer = undefined;
  armedLink = null;
}

function armPrefetch(link: HTMLAnchorElement): void {
  const url = eligibleForPrefetch(link);
  if (!url) return;
  armedLink = link;
  hoverTimer = setTimeout(() => prefetch(url), HOVER_DELAY);
}

document.addEventListener("mouseover", (event) => {
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
  if (link === armedLink) return;
  disarmPrefetch();
  if (link) armPrefetch(link);
});

document.addEventListener("mouseout", (event) => {
  if (!armedLink) return;
  const related = event.relatedTarget as Node | null;
  if (related && armedLink.contains(related)) return;
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
  if (link === armedLink) disarmPrefetch();
});

document.addEventListener("focusin", (event) => {
  const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
  if (!link) return;
  disarmPrefetch();
  armPrefetch(link);
});

document.addEventListener("focusout", () => disarmPrefetch());

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
  const url = new URL(form.action || renderedURL, location.href);
  if (!internal(url)) return;
  event.preventDefault();
  const method = form.method.toUpperCase();
  const data = new FormData(form, event.submitter as HTMLElement | null ?? undefined);
  if (method === "GET") {
    const query = new URLSearchParams();
    for (const [key, value] of data) if (typeof value === "string") query.append(key, value);
    url.search = query.toString();
    void navigate(url);
  } else {
    void navigate(url, { method, body: data }, "none");
  }
});

addEventListener("popstate", () => {
  void navigate(new URL(location.href), undefined, "none");
});

export {};

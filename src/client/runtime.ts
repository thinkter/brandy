import { getFormSearchParams } from "./forms.ts";

declare const __BRANDY_ALPINE_CHUNK__: string;
declare const __BRANDY_DEV__: boolean;

declare global {
  interface Window {
    Brandy?: { reinit?: (root: Element) => void; ensureIsland?: (root: ParentNode) => void };
  }
}

const PARTIAL = "x-brandy-navigation";
const CURRENT = "x-brandy-current-url";
const PREFETCH = "x-brandy-prefetch";
const STREAM = "x-brandy-stream";
const NO_INTERCEPT = "x-brandy-no-intercept";
const STREAM_BOUNDARY = "<!--brandy:stream-boundary-->";
const HOVER_DELAY = 100;

let renderedURL = location.pathname + location.search;

interface FragmentResult {
  html: string;
  retarget: string | null;
  reswap: string | null;
  finalURL: string | null;
  status: number;
  streamed: boolean;
}

interface PrefetchEntry {
  promise: Promise<PrefetchedResult>;
  currentURL: string;
}

type PrefetchedResult =
  | { kind: "fragment"; result: FragmentResult }
  | { kind: "stream"; response: Response };

const prefetchCache = new Map<string, PrefetchEntry>();
let armedLink: HTMLAnchorElement | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;

function internal(url: URL): boolean { return url.origin === location.origin; }

function cacheKey(url: URL): string { return url.pathname + url.search; }

function reconcileHead(root: ParentNode): void {
  const update = root.querySelector<HTMLTemplateElement>("template[data-brandy-head]");
  if (!update) return;
  if (update.dataset.brandyHead === "merge") {
    const metadataKey = (element: Element): string => {
      if (element.tagName === "TITLE") return "title";
      const identity = ["name", "property", "http-equiv", "charset", "itemprop"]
        .map((attribute) => element.getAttribute(attribute))
        .find((value) => value !== null);
      return `${element.tagName}:${identity ?? element.outerHTML}`;
    };
    const incoming = new Set(Array.from(update.content.children, metadataKey));
    document.head.querySelectorAll("[data-brandy-metadata]").forEach((node) => {
      if (incoming.has(metadataKey(node))) node.remove();
    });
  } else {
    document.head.querySelectorAll("[data-brandy-metadata]").forEach((node) => node.remove());
  }
  document.head.append(update.content.cloneNode(true));
  update.remove();
}

/** Applies every out-of-band template in a fragment: head metadata plus any deferred stream content. */
function reconcileStream(root: ParentNode, reinitializeTargets = true): void {
  reconcileHead(root);
  root.querySelectorAll<HTMLTemplateElement>("template[data-brandy-stream-target]").forEach((template) => {
    const id = template.dataset.brandyStreamTarget;
    const slot = id && document.getElementById(id);
    if (slot) {
      slot.replaceChildren(template.content.cloneNode(true));
      if (reinitializeTargets) reinitialize(slot);
    }
    template.remove();
  });
}

function needsIsland(root: ParentNode): boolean {
  return root.querySelector("[data-brandy-island]") !== null;
}

let alpineLoad: Promise<unknown> | undefined;

function ensureAlpine(): Promise<unknown> {
  return alpineLoad ??= import(__BRANDY_ALPINE_CHUNK__).catch((error: unknown) => {
    console.error("[brandy] failed to load Alpine", error);
  });
}

// Dev-only footgun check: an x-data node outside an Island renders fine but never becomes
// interactive, since Alpine is only fetched when a data-brandy-island marker is present.
function warnOrphanIslands(root: ParentNode): void {
  root.querySelectorAll("[x-data]").forEach((node) => {
    if (!node.closest("[data-brandy-island]")) {
      console.warn("[brandy] x-data used outside an <Island> — this element will never become interactive:", node);
    }
  });
}

function ensureIsland(root: ParentNode): void {
  if (needsIsland(root)) void ensureAlpine();
  if (__BRANDY_DEV__) warnOrphanIslands(root);
}

window.Brandy = window.Brandy ?? {};
window.Brandy.ensureIsland = ensureIsland;

if (needsIsland(document)) void ensureAlpine();

function reinitialize(root: Element): void {
  ensureIsland(root);
  window.Brandy?.reinit?.(root);
}

function fetchHeaders(init?: RequestInit, prefetch = false): Record<string, string> {
  const headers: Record<string, string> = {
    ...Object.fromEntries(new Headers(init?.headers)),
    [PARTIAL]: "1",
    [CURRENT]: renderedURL,
  };
  if (prefetch) headers[PREFETCH] = "1";
  return headers;
}

function performFetch(url: URL, init?: RequestInit, prefetch = false): Promise<Response> {
  return fetch(url, { ...init, headers: fetchHeaders(init, prefetch) });
}

async function readFragment(response: Response): Promise<FragmentResult> {
  return {
    html: await response.text(),
    retarget: response.headers.get("x-brandy-retarget"),
    reswap: response.headers.get("x-brandy-reswap"),
    finalURL: response.headers.get("x-brandy-url"),
    status: response.status,
    streamed: response.headers.get(STREAM) === "1",
  };
}

async function fetchPrefetch(url: URL): Promise<PrefetchedResult> {
  const response = await performFetch(url, undefined, true);
  return response.headers.get(STREAM) === "1" && response.body
    ? { kind: "stream", response }
    : { kind: "fragment", result: await readFragment(response) };
}

/** Splits a buffered stream on the sentinel comment the server emits between the skeleton and the
 * deferred real content. Returns null until the full sentinel has arrived in the buffer. */
function splitStream(buffer: string): { skeleton: string; rest: string } | null {
  const index = buffer.indexOf(STREAM_BOUNDARY);
  if (index === -1) return null;
  return { skeleton: buffer.slice(0, index), rest: buffer.slice(index + STREAM_BOUNDARY.length) };
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
  if (result.streamed) {
    target.replaceChildren(template.content.cloneNode(true));
    reconcileStream(target, false);
  } else {
    // Ordinary (non-streamed) responses can still carry an OOB template — e.g. the modal-outlet
    // clear instruction on an intercepting-routes app — so this needs the same generalized scan.
    reconcileStream(template.content);
    target.replaceChildren(template.content.cloneNode(true));
  }
  const finalURL = result.finalURL ?? `${url.pathname}${url.search}`;
  if (historyMode === "push" || finalURL !== renderedURL && url.pathname.startsWith("/_brandy/actions/")) {
    history.pushState({}, "", finalURL);
  }
  renderedURL = finalURL;
  reinitialize(target);
}

async function applyStreamedFragment(response: Response, url: URL, historyMode: "push" | "none"): Promise<void> {
  const retarget = response.headers.get("x-brandy-retarget");
  const reswap = response.headers.get("x-brandy-reswap");
  const finalURLHeader = response.headers.get("x-brandy-url");
  const target = retarget && document.querySelector(retarget);
  if (!target || reswap !== "innerHTML" || !response.body) {
    location.assign(finalURLHeader ?? url.href);
    return;
  }
  prefetchCache.clear();
  disarmPrefetch();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let skeletonApplied = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (!skeletonApplied) {
      const split = splitStream(buffer);
      if (split) {
        const template = document.createElement("template");
        template.innerHTML = split.skeleton;
        target.replaceChildren(template.content.cloneNode(true));
        skeletonApplied = true;
        buffer = split.rest;
      }
    }
    if (done) break;
  }
  buffer += decoder.decode();
  if (!skeletonApplied) {
    const template = document.createElement("template");
    template.innerHTML = buffer;
    target.replaceChildren(template.content.cloneNode(true));
    buffer = "";
  }

  const finalURL = finalURLHeader ?? `${url.pathname}${url.search}`;
  if (historyMode === "push" || finalURL !== renderedURL && url.pathname.startsWith("/_brandy/actions/")) {
    history.pushState({}, "", finalURL);
  }
  renderedURL = finalURL;
  reinitialize(target);

  if (buffer) {
    const restTemplate = document.createElement("template");
    restTemplate.innerHTML = buffer;
    reconcileStream(restTemplate.content);
  }
}

async function navigate(url: URL, init?: RequestInit, historyMode: "push" | "none" = "push"): Promise<void> {
  const key = cacheKey(url);
  const cached = !init ? prefetchCache.get(key) : undefined;
  if (cached && cached.currentURL === renderedURL) {
    prefetchCache.delete(key);
    try {
      const prefetched = await cached.promise;
      if (prefetched.kind === "stream") await applyStreamedFragment(prefetched.response, url, historyMode);
      else applyFragment(prefetched.result, url, historyMode);
    } catch {
      location.assign(url);
    }
    return;
  }

  let response: Response;
  try {
    response = await performFetch(url, init);
  } catch {
    location.assign(url);
    return;
  }

  if (response.headers.get(STREAM) === "1") {
    try {
      await applyStreamedFragment(response, url, historyMode);
    } catch {
      location.assign(url);
    }
    return;
  }

  let result: FragmentResult;
  try {
    result = await readFragment(response);
  } catch {
    location.assign(url);
    return;
  }
  applyFragment(result, url, historyMode);
}

function eligibleForPrefetch(link: HTMLAnchorElement): URL | null {
  // A no-intercept link always bypasses the prefetch cache on click (see the click handler),
  // so prefetching it would be wasted work — skip it entirely rather than cache something unusable.
  if (link.target || link.download || link.hasAttribute("data-brandy-reload") || link.hasAttribute("data-brandy-no-prefetch") || link.hasAttribute("data-brandy-no-intercept")) return null;
  const url = new URL(link.href, location.href);
  if (!internal(url)) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;
  return url;
}

function prefetch(url: URL): void {
  const key = cacheKey(url);
  if (prefetchCache.has(key)) return;
  const promise = fetchPrefetch(url);
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
  // Passing init (even just to carry a header) also disables cache-hit reuse for this click,
  // which is correct: a prefetch issued without this intent could be the wrong (intercepted) variant.
  const init = link.hasAttribute("data-brandy-no-intercept") ? { headers: { [NO_INTERCEPT]: "1" } } : undefined;
  void navigate(url, init);
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
    url.search = getFormSearchParams(data).toString();
    void navigate(url);
  } else {
    void navigate(url, { method, body: data }, "none");
  }
});

addEventListener("popstate", () => {
  void navigate(new URL(location.href), undefined, "none");
});

export {};

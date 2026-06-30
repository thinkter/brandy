declare global {
  interface Window {
    Brandy?: { reinit?: (root: Element) => void };
  }
}

const PARTIAL = "x-brandy-navigation";
const CURRENT = "x-brandy-current-url";
let renderedURL = location.pathname + location.search;

function internal(url: URL): boolean { return url.origin === location.origin; }

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

async function navigate(url: URL, init?: RequestInit, historyMode: "push" | "none" = "push"): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init?.headers)), [PARTIAL]: "1", [CURRENT]: renderedURL },
    });
  } catch {
    location.assign(url);
    return;
  }
  const selector = response.headers.get("x-brandy-retarget");
  const mode = response.headers.get("x-brandy-reswap");
  const target = selector && document.querySelector(selector);
  if (!target || mode !== "innerHTML") {
    location.assign(response.url || url);
    return;
  }
  const template = document.createElement("template");
  template.innerHTML = await response.text();
  reconcileHead(template.content);
  target.replaceChildren(template.content.cloneNode(true));
  const finalURL = response.headers.get("x-brandy-url") ?? `${url.pathname}${url.search}`;
  if (historyMode === "push" || finalURL !== renderedURL && url.pathname.startsWith("/_brandy/actions/")) {
    history.pushState({}, "", finalURL);
  }
  renderedURL = finalURL;
  reinitialize(target);
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

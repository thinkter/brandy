/**
 * Client runtime test harness (issue #17)
 *
 * Tests the invariant-critical browser logic in src/client/runtime.ts using a
 * happy-dom Window so the module-level DOM setup (event listeners, location,
 * history) runs inside a real DOM-like environment instead of Node globals.
 *
 * Architecture note
 * -----------------
 * runtime.ts registers event listeners on `document` and reads `location` at
 * module-evaluation time.  Bun caches ES modules, so there is effectively one
 * runtime instance per test run.  We therefore:
 *   1. Set up a single happy-dom Window and install it into globalThis *before*
 *      the runtime is imported (using a dynamic import at the top of the file,
 *      executed once via a module-level await).
 *   2. Between tests, reset `document.body` / `document.head` and replace
 *      `globalThis.fetch` — the runtime reads these through globalThis at
 *      call time, so per-test overrides work correctly.
 *
 * Coverage
 * --------
 *   - splitStream pure utility (no DOM, imported from stream-utils.ts)
 *   - Intercept navigation → fetch → swap → pushState
 *   - Out-of-band (OOB) reconciliation (data-brandy-stream-target)
 *   - Head reconciliation (data-brandy-head replace and merge modes)
 *   - Prefetch cache hit / miss as currently implemented
 *   - Streamed fragment (skeleton + OOB rest via stream splitting)
 *   - History handling (popstate, GET / POST form submission)
 */

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

// ---------------------------------------------------------------------------
// Pure unit tests – no DOM required
// splitStream lives in stream-utils.ts which has zero browser-global deps.
// ---------------------------------------------------------------------------
import { splitStream } from "../src/client/stream-utils.ts";

const BOUNDARY = "<!--brandy:stream-boundary-->";

describe("splitStream", () => {
  test("returns null when the sentinel has not yet arrived", () => {
    expect(splitStream("")).toBeNull();
    expect(splitStream("<div>partial content")).toBeNull();
    expect(splitStream("<!--brandy:stream-bound")).toBeNull();
  });

  test("splits correctly when the sentinel is present", () => {
    const buffer = `<main>SKELETON</main>${BOUNDARY}<template data-brandy-stream-target="slot"><p>real</p></template>`;
    const result = splitStream(buffer);
    expect(result).not.toBeNull();
    expect(result!.skeleton).toBe("<main>SKELETON</main>");
    expect(result!.rest).toBe(`<template data-brandy-stream-target="slot"><p>real</p></template>`);
  });

  test("skeleton may be empty (sentinel at the very start)", () => {
    const result = splitStream(`${BOUNDARY}<p>real</p>`);
    expect(result).not.toBeNull();
    expect(result!.skeleton).toBe("");
    expect(result!.rest).toBe("<p>real</p>");
  });

  test("rest may be empty (sentinel at the very end)", () => {
    const result = splitStream(`<main>SKELETON</main>${BOUNDARY}`);
    expect(result).not.toBeNull();
    expect(result!.skeleton).toBe("<main>SKELETON</main>");
    expect(result!.rest).toBe("");
  });

  test("uses only the first occurrence when the sentinel appears multiple times", () => {
    const result = splitStream(`A${BOUNDARY}B${BOUNDARY}C`);
    expect(result!.skeleton).toBe("A");
    expect(result!.rest).toBe(`B${BOUNDARY}C`);
  });
});

// ---------------------------------------------------------------------------
// DOM-bound test suites
//
// A single happy-dom Window is shared across all DOM suites.  The runtime is
// imported once (dynamically) after the globals are wired up.
// ---------------------------------------------------------------------------

// Shared window — initialised in beforeAll at the bottom of this section.
let sharedWin: InstanceType<typeof Window>;
// Saved original globals so afterAll can restore them and avoid contaminating other test files.
const savedGlobals: Record<string, unknown> = {};

/** Replace globalThis.fetch with a mock that returns a simple fragment response. */
function setFragmentFetch(html: string, extraHeaders: Record<string, string> = {}) {
  const fetchMock = mock(async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    return new Response(html, {
      status: 200,
      headers: {
        "x-brandy-retarget": "#main",
        "x-brandy-reswap": "innerHTML",
        ...extraHeaders,
      },
    });
  });
  (globalThis as Record<string, unknown>)["fetch"] = fetchMock;
  return fetchMock;
}

/** Dispatch a left-button click on el, wait for async work to settle. */
async function click(el: Element, win: InstanceType<typeof Window>, delay = 30) {
  el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  await new Promise<void>((r) => setTimeout(r, delay));
}

// One-time setup: build the window, wire globals, then import the runtime so
// its module-level code (addEventListener calls, renderedURL init) runs inside
// the happy-dom environment.
beforeAll(async () => {
  sharedWin = new Window({ url: "http://localhost/" });

  // Save originals so afterAll can restore them, preventing global pollution
  // from affecting other test files (e.g. the integration tests that need the
  // native Bun FormData constructor).
  const keys = ["window", "document", "location", "history", "addEventListener",
    "removeEventListener", "HTMLFormElement", "FormData", "fetch",
    "__BRANDY_ALPINE_CHUNK__", "__BRANDY_DEV__"];
  for (const key of keys) {
    savedGlobals[key] = (globalThis as Record<string, unknown>)[key];
  }

  (globalThis as Record<string, unknown>)["window"] = sharedWin;
  (globalThis as Record<string, unknown>)["document"] = sharedWin.document;
  (globalThis as Record<string, unknown>)["location"] = sharedWin.location;
  (globalThis as Record<string, unknown>)["history"] = sharedWin.history;
  (globalThis as Record<string, unknown>)["addEventListener"] = sharedWin.addEventListener.bind(sharedWin);
  (globalThis as Record<string, unknown>)["removeEventListener"] = sharedWin.removeEventListener.bind(sharedWin);
  // The submit handler checks `form instanceof HTMLFormElement`; we need the
  // happy-dom class in globalThis so the instanceof check resolves correctly.
  (globalThis as Record<string, unknown>)["HTMLFormElement"] = sharedWin.HTMLFormElement;
  // The runtime builds FormData from the form element; Bun's native FormData
  // constructor does not understand happy-dom elements, so we replace it too.
  (globalThis as Record<string, unknown>)["FormData"] = sharedWin.FormData;

  // Build-time constants declared by runtime.ts
  (globalThis as Record<string, unknown>)["__BRANDY_ALPINE_CHUNK__"] = "/fake-alpine.js";
  (globalThis as Record<string, unknown>)["__BRANDY_DEV__"] = false;

  // Import once — this is when the event listeners are registered on
  // sharedWin.document and renderedURL is set to "/".
  await import("../src/client/runtime.ts");

  // Register a fallback click/submit handler AFTER the runtime has registered
  // its own.  Bubble-phase listeners fire in registration order, so this runs
  // after the runtime's handler.  For links/forms the runtime did NOT intercept
  // (external links, data-brandy-reload, modifier clicks) the runtime returns
  // without calling event.preventDefault(), which would cause happy-dom to
  // follow the href and navigate the window to a different origin — breaking
  // all subsequent internal-link checks.  Calling preventDefault() here stops
  // happy-dom's native navigation without affecting anything the runtime did.
  sharedWin.document.addEventListener("click", (event) => { event.preventDefault(); });
  sharedWin.document.addEventListener("submit", (event) => { event.preventDefault(); });
});

// Restore all overridden globals after this file's tests complete so that
// other test files that run in the same Bun worker (e.g. integration.test.ts)
// get the original native implementations back.
afterAll(() => {
  for (const [key, value] of Object.entries(savedGlobals)) {
    (globalThis as Record<string, unknown>)[key] = value;
  }
});

// Do not call mock.restore() here — it would undo globalThis.fetch assignments
// made via mock() and restore Bun's built-in fetch, breaking subsequent tests.
// Each test sets its own fetch mock via setFragmentFetch().

// ---------------------------------------------------------------------------
// Suite 1 – Intercept navigation → fetch → swap → pushState
// ---------------------------------------------------------------------------

describe("intercept navigation", () => {
  beforeEach(() => {
    sharedWin.document.body.innerHTML = `<div id="main"><p>old content</p></div>`;
    // Reset location to a known start for each test
    sharedWin.history.pushState({}, "", "/start");
  });

  test("clicking an internal link calls fetch with partial navigation headers", async () => {
    const fetchMock = setFragmentFetch("<p>new content</p>");
    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/about";
    sharedWin.document.body.appendChild(link);

    await click(link, sharedWin);

    expect(fetchMock).toHaveBeenCalled();
    const [calledURL, calledInit] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledURL.pathname).toBe("/about");
    const headers = calledInit.headers as Record<string, string>;
    expect(headers["x-brandy-navigation"]).toBe("1");
    // x-brandy-current-url reflects the renderedURL at time of click
    expect(typeof headers["x-brandy-current-url"]).toBe("string");
  });

  test("target element content is swapped after navigation", async () => {
    setFragmentFetch("<p>swapped content</p>");
    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/swapped";
    sharedWin.document.body.appendChild(link);

    await click(link, sharedWin);

    expect(sharedWin.document.getElementById("main")!.innerHTML).toContain("swapped content");
  });

  test("pushState updates location after navigation", async () => {
    setFragmentFetch("<p>content</p>");
    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/pushed";
    sharedWin.document.body.appendChild(link);

    await click(link, sharedWin);

    expect(sharedWin.location.pathname).toBe("/pushed");
  });

  test("link with data-brandy-reload is not intercepted", async () => {
    const fetchMock = setFragmentFetch("<p>content</p>");
    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/reload-target";
    link.setAttribute("data-brandy-reload", "");
    sharedWin.document.body.appendChild(link);

    await click(link, sharedWin);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("modifier-key click (metaKey) is not intercepted", async () => {
    const fetchMock = setFragmentFetch("<p>content</p>");
    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/about";
    sharedWin.document.body.appendChild(link);

    link.dispatchEvent(new sharedWin.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true }));
    await new Promise<void>((r) => setTimeout(r, 30));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("external link is not intercepted", async () => {
    const fetchMock = setFragmentFetch("<p>content</p>");
    const link = sharedWin.document.createElement("a");
    link.href = "https://example.com/external";
    sharedWin.document.body.appendChild(link);

    await click(link, sharedWin);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("data-brandy-no-intercept link sends x-brandy-no-intercept header", async () => {
    const fetchMock = setFragmentFetch("<p>content</p>");
    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/standalone";
    link.setAttribute("data-brandy-no-intercept", "");
    sharedWin.document.body.appendChild(link);

    await click(link, sharedWin);

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)["x-brandy-no-intercept"]).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Suite 2 – Out-of-band (OOB) reconciliation (data-brandy-stream-target)
// ---------------------------------------------------------------------------

describe("out-of-band reconciliation", () => {
  beforeEach(() => {
    sharedWin.document.body.innerHTML = `
      <div id="main"><p>old</p></div>
      <div id="sidebar"><p>original sidebar</p></div>
    `;
    sharedWin.history.pushState({}, "", "/page");
  });

  test("OOB template is applied to its target slot", async () => {
    const html = `<p>new main</p><template data-brandy-stream-target="sidebar"><p>oob sidebar</p></template>`;
    (globalThis as Record<string, unknown>)["fetch"] = mock(async (): Promise<Response> =>
      new Response(html, { headers: { "x-brandy-retarget": "#main", "x-brandy-reswap": "innerHTML" } })
    );

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/other";
    sharedWin.document.body.appendChild(link);

    await click(link, sharedWin);

    expect(sharedWin.document.getElementById("sidebar")!.innerHTML).toContain("oob sidebar");
  });

  test("OOB template element is removed from the DOM after reconciliation", async () => {
    const html = `<p>new main</p><template data-brandy-stream-target="sidebar"><p>oob sidebar</p></template>`;
    (globalThis as Record<string, unknown>)["fetch"] = mock(async (): Promise<Response> =>
      new Response(html, { headers: { "x-brandy-retarget": "#main", "x-brandy-reswap": "innerHTML" } })
    );

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/other2";
    sharedWin.document.body.appendChild(link);

    await click(link, sharedWin);

    expect(sharedWin.document.querySelector("template[data-brandy-stream-target]")).toBeNull();
  });

  test("the main swap content does not contain the OOB template markup", async () => {
    const html = `<p>new main</p><template data-brandy-stream-target="sidebar"><p>oob sidebar</p></template>`;
    (globalThis as Record<string, unknown>)["fetch"] = mock(async (): Promise<Response> =>
      new Response(html, { headers: { "x-brandy-retarget": "#main", "x-brandy-reswap": "innerHTML" } })
    );

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/other3";
    sharedWin.document.body.appendChild(link);

    await click(link, sharedWin);

    const main = sharedWin.document.getElementById("main");
    expect(main!.innerHTML).not.toContain("data-brandy-stream-target");
    expect(main!.innerHTML).toContain("new main");
  });
});

// ---------------------------------------------------------------------------
// Suite 3 – Head reconciliation (data-brandy-head)
// ---------------------------------------------------------------------------

describe("head reconciliation", () => {
  beforeEach(() => {
    sharedWin.document.body.innerHTML = `<div id="main"><p>old</p></div>`;
    sharedWin.history.pushState({}, "", "/headpage");
  });

  test("replace mode removes all old metadata nodes and appends new ones", async () => {
    sharedWin.document.head.innerHTML = `<title data-brandy-metadata>Old Title</title>`;

    const html = `<p>content</p><template data-brandy-head="replace"><title data-brandy-metadata>New Title</title></template>`;
    (globalThis as Record<string, unknown>)["fetch"] = mock(async (): Promise<Response> =>
      new Response(html, { headers: { "x-brandy-retarget": "#main", "x-brandy-reswap": "innerHTML" } })
    );

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/head-replace";
    sharedWin.document.body.appendChild(link);
    await click(link, sharedWin);

    const titles = sharedWin.document.head.querySelectorAll("title");
    expect(titles.length).toBe(1);
    expect(titles[0]!.textContent).toBe("New Title");
  });

  test("merge mode replaces overlapping keys and keeps the rest", async () => {
    sharedWin.document.head.innerHTML = `
      <title data-brandy-metadata>Old Title</title>
      <meta name="description" content="Old description" data-brandy-metadata>
    `;

    const html = `<p>content</p><template data-brandy-head="merge"><title data-brandy-metadata>New Title</title></template>`;
    (globalThis as Record<string, unknown>)["fetch"] = mock(async (): Promise<Response> =>
      new Response(html, { headers: { "x-brandy-retarget": "#main", "x-brandy-reswap": "innerHTML" } })
    );

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/head-merge";
    sharedWin.document.body.appendChild(link);
    await click(link, sharedWin);

    const titles = sharedWin.document.head.querySelectorAll("title");
    expect(titles.length).toBe(1);
    expect(titles[0]!.textContent).toBe("New Title");

    const desc = sharedWin.document.head.querySelector('meta[name="description"]');
    expect(desc).not.toBeNull();
    expect(desc!.getAttribute("content")).toBe("Old description");
  });
});

// ---------------------------------------------------------------------------
// Suite 4 – Prefetch cache (hit / miss)
// ---------------------------------------------------------------------------

describe("prefetch cache", () => {
  beforeEach(() => {
    sharedWin.document.body.innerHTML = `<div id="main"><p>home</p></div>`;
    sharedWin.history.pushState({}, "", "/home");
  });

  test("hovering a link past HOVER_DELAY triggers a prefetch with x-brandy-prefetch header", async () => {
    const fetchMock = setFragmentFetch("<p>prefetched page</p>");

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/prefetch-target";
    sharedWin.document.body.appendChild(link);

    link.dispatchEvent(new sharedWin.MouseEvent("mouseover", { bubbles: true }));
    await new Promise<void>((r) => setTimeout(r, 150)); // > HOVER_DELAY (100ms)

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)["x-brandy-prefetch"]).toBe("1");
  });

  test("cache hit: clicking a prefetched link does not issue a second fetch", async () => {
    const fetchMock = setFragmentFetch("<p>cached page</p>");

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/cached-nav";
    sharedWin.document.body.appendChild(link);

    // Trigger prefetch
    link.dispatchEvent(new sharedWin.MouseEvent("mouseover", { bubbles: true }));
    await new Promise<void>((r) => setTimeout(r, 150));
    const prefetchCount = fetchMock.mock.calls.length;
    expect(prefetchCount).toBe(1);

    // Click — should consume the cache, not call fetch again
    await click(link, sharedWin);

    expect(fetchMock.mock.calls.length).toBe(prefetchCount);
    expect(sharedWin.document.getElementById("main")!.innerHTML).toContain("cached page");
  });

  test("cache miss: clicking without prior hover calls fetch exactly once", async () => {
    const fetchMock = setFragmentFetch("<p>fresh page</p>");

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/fresh-nav";
    sharedWin.document.body.appendChild(link);

    await click(link, sharedWin);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledURL, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledURL.pathname).toBe("/fresh-nav");
    expect((init.headers as Record<string, string>)["x-brandy-prefetch"]).toBeUndefined();
  });

  test("mouseout before HOVER_DELAY cancels the prefetch timer", async () => {
    const fetchMock = setFragmentFetch("<p>cancelled</p>");

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/cancelled-prefetch";
    sharedWin.document.body.appendChild(link);

    link.dispatchEvent(new sharedWin.MouseEvent("mouseover", { bubbles: true }));
    // Mouse leaves before the 100ms timer fires
    link.dispatchEvent(new sharedWin.MouseEvent("mouseout", { bubbles: true, relatedTarget: sharedWin.document.body }));

    await new Promise<void>((r) => setTimeout(r, 150));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("data-brandy-no-prefetch links are never prefetched on hover", async () => {
    const fetchMock = setFragmentFetch("<p>no prefetch</p>");

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/skip-prefetch";
    link.setAttribute("data-brandy-no-prefetch", "");
    sharedWin.document.body.appendChild(link);

    link.dispatchEvent(new sharedWin.MouseEvent("mouseover", { bubbles: true }));
    await new Promise<void>((r) => setTimeout(r, 150));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("same-page links (matching pathname+search) are not prefetched", async () => {
    const fetchMock = setFragmentFetch("<p>same page</p>");

    const link = sharedWin.document.createElement("a");
    // href matches the current renderedURL (/home set in beforeEach)
    link.href = "http://localhost/home";
    sharedWin.document.body.appendChild(link);

    link.dispatchEvent(new sharedWin.MouseEvent("mouseover", { bubbles: true }));
    await new Promise<void>((r) => setTimeout(r, 150));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 5 – Streamed fragment (stream splitting + OOB rest)
// ---------------------------------------------------------------------------

describe("streamed fragment", () => {
  beforeEach(() => {
    sharedWin.document.body.innerHTML = `<div id="main"><p>old</p></div>`;
    sharedWin.history.pushState({}, "", "/stream-page");
  });

  function makeStreamResponse(skeleton: string, rest: string, extraHeaders: Record<string, string> = {}) {
    const encoder = new TextEncoder();
    const fullBody = `${skeleton}${BOUNDARY}${rest}`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(fullBody));
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "x-brandy-retarget": "#main",
        "x-brandy-reswap": "innerHTML",
        "x-brandy-stream": "1",
        ...extraHeaders,
      },
    });
  }

  test("skeleton is swapped into the target; OOB rest is reconciled after stream ends", async () => {
    const sidebar = sharedWin.document.createElement("div");
    sidebar.id = "stream-sidebar";
    sidebar.innerHTML = "<p>old sidebar</p>";
    sharedWin.document.body.appendChild(sidebar);

    const oob = `<template data-brandy-stream-target="stream-sidebar"><p>real sidebar</p></template>`;
    (globalThis as Record<string, unknown>)["fetch"] = mock(async (): Promise<Response> =>
      makeStreamResponse("<p>SKELETON</p>", oob)
    );

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/streamed";
    sharedWin.document.body.appendChild(link);
    await click(link, sharedWin, 80);

    expect(sharedWin.document.getElementById("main")!.innerHTML).toContain("SKELETON");
    expect(sharedWin.document.getElementById("stream-sidebar")!.innerHTML).toContain("real sidebar");
  });

  test("response without a boundary applies the whole buffer to the target", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("<p>complete content</p>"));
        controller.close();
      },
    });
    (globalThis as Record<string, unknown>)["fetch"] = mock(async (): Promise<Response> =>
      new Response(stream, {
        headers: { "x-brandy-retarget": "#main", "x-brandy-reswap": "innerHTML", "x-brandy-stream": "1" },
      })
    );

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/no-boundary";
    sharedWin.document.body.appendChild(link);
    await click(link, sharedWin, 80);

    expect(sharedWin.document.getElementById("main")!.innerHTML).toContain("complete content");
  });

  test("x-brandy-url header overrides the pathname for pushState", async () => {
    (globalThis as Record<string, unknown>)["fetch"] = mock(async (): Promise<Response> =>
      makeStreamResponse("<p>content</p>", "", { "x-brandy-url": "/redirected-path" })
    );

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/original";
    sharedWin.document.body.appendChild(link);
    await click(link, sharedWin, 80);

    expect(sharedWin.location.pathname).toBe("/redirected-path");
  });
});

// ---------------------------------------------------------------------------
// Suite 6 – History handling (popstate / form submission)
// ---------------------------------------------------------------------------

describe("history handling", () => {
  beforeEach(() => {
    sharedWin.document.body.innerHTML = `<div id="main"><p>page</p></div>`;
    sharedWin.history.pushState({}, "", "/first");
  });

  test("forward navigation via link pushes a new history entry", async () => {
    setFragmentFetch("<p>second</p>");

    const link = sharedWin.document.createElement("a");
    link.href = "http://localhost/second";
    sharedWin.document.body.appendChild(link);
    await click(link, sharedWin);

    expect(sharedWin.location.pathname).toBe("/second");
  });

  test("popstate triggers a navigate() call for the current location", async () => {
    const fetchMock = setFragmentFetch("<p>restored</p>");

    sharedWin.dispatchEvent(new sharedWin.PopStateEvent("popstate", { state: null }));
    await new Promise<void>((r) => setTimeout(r, 30));

    expect(fetchMock).toHaveBeenCalled();
    const [calledURL] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledURL.pathname).toBe(sharedWin.location.pathname);
  });

  test("popstate navigation does not push an extra history entry", async () => {
    setFragmentFetch("<p>restored</p>");
    const lengthBefore = sharedWin.history.length;

    sharedWin.dispatchEvent(new sharedWin.PopStateEvent("popstate", { state: null }));
    await new Promise<void>((r) => setTimeout(r, 30));

    // historyMode is "none" for popstate — history.length must not grow
    expect(sharedWin.history.length).toBe(lengthBefore);
  });

  test("GET form submission encodes fields as query params and navigates", async () => {
    const fetchMock = setFragmentFetch("<p>search results</p>");

    const form = sharedWin.document.createElement("form");
    form.method = "get";
    form.action = "http://localhost/search";
    const input = sharedWin.document.createElement("input");
    input.name = "q";
    input.value = "hello";
    form.appendChild(input);
    sharedWin.document.body.appendChild(form);

    form.dispatchEvent(new sharedWin.SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await new Promise<void>((r) => setTimeout(r, 30));

    expect(fetchMock).toHaveBeenCalled();
    const [calledURL] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(calledURL.pathname).toBe("/search");
    expect(calledURL.searchParams.get("q")).toBe("hello");
  });

  test("POST form submission calls fetch with method POST", async () => {
    const fetchMock = setFragmentFetch("<p>posted</p>");

    const form = sharedWin.document.createElement("form");
    form.method = "post";
    form.action = "http://localhost/submit";
    sharedWin.document.body.appendChild(form);

    form.dispatchEvent(new sharedWin.SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await new Promise<void>((r) => setTimeout(r, 30));

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init as RequestInit).method?.toUpperCase()).toBe("POST");
  });

  test("form with data-brandy-reload is not intercepted", async () => {
    const fetchMock = setFragmentFetch("<p>nosubmit</p>");

    const form = sharedWin.document.createElement("form");
    form.method = "get";
    form.action = "http://localhost/nosubmit";
    form.setAttribute("data-brandy-reload", "");
    sharedWin.document.body.appendChild(form);

    form.dispatchEvent(new sharedWin.SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await new Promise<void>((r) => setTimeout(r, 30));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

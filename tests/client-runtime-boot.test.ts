/**
 * Boot-sweep tests for the client runtime (issue #6).
 *
 * A streamed cold load delivers deferred content, head metadata, and mid-stream redirects as
 * inert declarative templates (streamSwap/metadataSwap/streamRedirect in core/render.ts). The
 * runtime is a module script, so it executes after the document — and therefore the stream —
 * has finished parsing, and applies whatever templates the initial document contains in one
 * sweep at module evaluation time.
 *
 * Each test needs the runtime's module-level code to run against a *pre-populated* document,
 * and Bun caches ES modules, so every scenario imports the runtime under a unique query string
 * to get a fresh module instance (the same cache-busting trick the dev server uses).
 */

import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const savedGlobals: Record<string, unknown> = {};
const GLOBAL_KEYS = ["window", "document", "location", "history", "addEventListener",
  "removeEventListener", "HTMLFormElement", "FormData", "fetch", "scrollTo",
  "__BRANDY_ALPINE_CHUNK__", "__BRANDY_DEV__"];

let bootCounter = 0;

async function bootRuntimeWith(bodyHTML: string, headHTML = ""): Promise<InstanceType<typeof Window>> {
  const win = new Window({ url: "http://localhost/" });
  for (const key of GLOBAL_KEYS) savedGlobals[key] = (globalThis as Record<string, unknown>)[key];
  Object.assign(globalThis as Record<string, unknown>, {
    window: win,
    document: win.document,
    location: win.location,
    history: win.history,
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win),
    HTMLFormElement: win.HTMLFormElement,
    FormData: win.FormData,
    fetch: mock(async () => new Response("")),
    scrollTo: () => {},
    __BRANDY_ALPINE_CHUNK__: "/_brandy/alpine.js",
    __BRANDY_DEV__: false,
  });
  win.document.head.innerHTML = headHTML;
  win.document.body.innerHTML = bodyHTML;
  // Unique query string → fresh module instance whose module-level boot sweep runs now,
  // against the document assembled above.
  await import(`../src/client/runtime.ts?boot=${++bootCounter}`);
  return win;
}

afterEach(() => {
  for (const key of GLOBAL_KEYS) (globalThis as Record<string, unknown>)[key] = savedGlobals[key];
});

test("the boot sweep applies deferred stream templates left in the initial document", async () => {
  const win = await bootRuntimeWith(`
    <div id="brandy-stream-slot" data-brandy-stream><main>SKELETON</main></div>
    <template data-brandy-stream-target="brandy-stream-slot"><main>REAL CONTENT</main></template>
  `);
  const slot = win.document.getElementById("brandy-stream-slot")!;
  expect(slot.innerHTML).toContain("REAL CONTENT");
  expect(slot.innerHTML).not.toContain("SKELETON");
  expect(win.document.querySelector("template[data-brandy-stream-target]")).toBeNull();
});

test("the boot sweep reconciles streamed head metadata", async () => {
  const win = await bootRuntimeWith(
    `<template data-brandy-head><title data-brandy-metadata>Deferred title</title></template>`,
    `<title data-brandy-metadata>Skeleton title</title>`,
  );
  expect(win.document.head.innerHTML).toContain("Deferred title");
  expect(win.document.head.innerHTML).not.toContain("Skeleton title");
});

test("the boot sweep applies a mid-stream redirect via location.replace", async () => {
  const replaceMock = mock((..._args: unknown[]) => {});
  const win = new Window({ url: "http://localhost/" });
  for (const key of GLOBAL_KEYS) savedGlobals[key] = (globalThis as Record<string, unknown>)[key];
  (win.location as unknown as { replace: typeof replaceMock }).replace = replaceMock;
  Object.assign(globalThis as Record<string, unknown>, {
    window: win,
    document: win.document,
    location: win.location,
    history: win.history,
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win),
    HTMLFormElement: win.HTMLFormElement,
    FormData: win.FormData,
    fetch: mock(async () => new Response("")),
    scrollTo: () => {},
    __BRANDY_ALPINE_CHUNK__: "/_brandy/alpine.js",
    __BRANDY_DEV__: false,
  });
  win.document.body.innerHTML = `
    <div id="brandy-stream-slot" data-brandy-stream><main>SKELETON</main></div>
    <template data-brandy-stream-redirect="/login"></template>
  `;
  await import(`../src/client/runtime.ts?boot=${++bootCounter}`);
  expect(replaceMock).toHaveBeenCalledWith("/login");
  expect(win.document.querySelector("template[data-brandy-stream-redirect]")).toBeNull();
});

test("the boot sweep is a no-op on an ordinary non-streamed document", async () => {
  const win = await bootRuntimeWith(`<main id="main">plain page</main>`);
  expect(win.document.getElementById("main")!.textContent).toBe("plain page");
});

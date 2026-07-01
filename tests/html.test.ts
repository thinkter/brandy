import { expect, test } from "bun:test";
import { findClosingTag, hasElementAttribute, insertBeforeClosingTag } from "../src/core/html.ts";
import { injectMetadata } from "../src/core/render.ts";
import { injectClientRuntime } from "../src/server.ts";

const document = `<html><head><script>const fake = "</head>";</script></head><body data-note="</body>"><script type="application/json">{"closing":"</body>","src":"/_brandy/runtime.js"}</script><main>content</main></body></html>`;

test("structural shell insertion ignores closing-tag text in scripts and attributes", () => {
  const withMetadata = injectMetadata(document, { title: "Safe title" });
  expect(withMetadata).toContain('<script>const fake = "</head>";</script><title data-brandy-metadata>Safe title</title></head>');

  const withRuntime = injectClientRuntime(document, "/_brandy/runtime.js");
  expect(withRuntime).toContain('<main>content</main><script type="module" src="/_brandy/runtime.js"></script></body>');
});

test("element attribute detection ignores matching text and finds real attributes", () => {
  expect(hasElementAttribute(document, "script", "src", "/_brandy/runtime.js")).toBe(false);
  const withRuntime = injectClientRuntime(document, "/_brandy/runtime.js");
  expect(hasElementAttribute(withRuntime, "script", "src", "/_brandy/runtime.js")).toBe(true);
  expect(injectClientRuntime(withRuntime, "/_brandy/runtime.js")).toBe(withRuntime);
});

test("document closing lookup ignores raw text and comments", () => {
  const input = `<html><body><!-- </body> --><textarea></body></textarea><p>safe</p></body></html>`;
  const closing = findClosingTag(input, "body");
  expect(input.slice(closing)).toBe("</body></html>");
  expect(insertBeforeClosingTag(input, "body", "<aside>injected</aside>")).toContain("<p>safe</p><aside>injected</aside></body>");
});

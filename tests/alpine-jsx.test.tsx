import { expect, test } from "bun:test";
import { Html } from "@elysiajs/html";
import type {} from "brandy";

function AlpineFixture() {
  const modifiers = {
    "x-show.important": "open",
    "x-on:click.prevent": "open = !open",
  } satisfies JSX.BrandyAlpineAttributes;

  return (
    <div x-data="{ open: false }" {...modifiers}>
      <button x-on:click="open = !open" x-bind:aria-expanded="open">
        Toggle
      </button>
    </div>
  );
}

function InvalidAlpineAttributeValue() {
  // @ts-expect-error Alpine expressions must be strings.
  return <div x-data={false} />;
}

test("direct Alpine attributes render unchanged", () => {
  expect(String(AlpineFixture())).toBe(
    '<div x-data="{ open: false }" x-show.important="open" x-on:click.prevent="open = !open"><button x-on:click="open = !open" x-bind:aria-expanded="open">Toggle</button></div>',
  );
});

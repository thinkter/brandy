import { escapeAttribute, slotId } from "./path.ts";
import type { LayoutNode, Route, RouteDiff } from "./types.ts";

function outlet(layout: LayoutNode, children: string): JSX.Element {
  return `<div id="${escapeAttribute(slotId(layout.id))}" data-brandy-slot>${children}</div>` as JSX.Element;
}

async function wrap(children: string, layouts: LayoutNode[]): Promise<string> {
  let html = children;
  for (let index = layouts.length - 1; index >= 0; index--) {
    const layout = layouts[index]!;
    html = String(await layout.render({ children: outlet(layout, html) }));
  }
  return html;
}

export async function renderFull(route: Route): Promise<string> {
  return wrap(String(await route.renderPage()), route.layouts);
}

export async function renderFragment(diff: RouteDiff): Promise<string> {
  return wrap(String(await diff.target.route.renderPage()), diff.chainToRender);
}

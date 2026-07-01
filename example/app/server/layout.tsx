import { Html } from "@elysiajs/html";
import type { LayoutRenderContext } from "brandy";
import { Code } from "../_components/ui.tsx";
import { getServerSnapshot } from "../_lib/server.ts";

export function load() {
  return getServerSnapshot();
}

type ServerLayoutData = Awaited<ReturnType<typeof load>>;

export default function ServerLayout({ children, data }: LayoutRenderContext<ServerLayoutData>) {
  return (
    <>
      <aside class="mx-auto mt-8 max-w-4xl rounded-xl border border-emerald-900 bg-emerald-950/40 px-5 py-4 text-sm text-emerald-200">
        The layout loader requested the shared snapshot. Memoized sample: <Code>{data.sampleId}</Code>
      </aside>
      {children}
    </>
  );
}

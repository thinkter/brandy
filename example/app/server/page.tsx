import { Html } from "@elysiajs/html";
import type { Metadata } from "brandy";
import { Badge, Card, Code, PageHeader, Stat } from "../_components/ui.tsx";
import { getServerActivity, getServerSnapshot } from "../_lib/server.ts";

export const metadata: Metadata = {
  title: "Server functions · Brandy",
  meta: { description: "Server-only functions in a Brandy loader" },
};

export async function load() {
  const [snapshot, activity] = await Promise.all([getServerSnapshot(), getServerActivity()]);
  return { snapshot, activity };
}

type ServerData = Awaited<ReturnType<typeof load>>;

export default function ServerPage({ data }: { data: ServerData }) {
  return (
    <main class="mx-auto max-w-4xl px-5 py-12">
      <PageHeader
        eyebrow="Server only"
        title="Functions that never reach the browser"
        description="This route reads the filesystem, operating system, and Bun process inside its loader. The browser receives only the rendered HTML."
      />

      <div class="mt-10 flex items-center gap-3">
        <Badge tone="success">Rendered on server</Badge>
        <span class="text-sm text-zinc-500">at {data.snapshot.renderedAt}</span>
      </div>

      <Card title="Live process snapshot" class="mt-6">
        <dl class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Runtime" value={data.snapshot.runtime} />
          <Stat label="Platform" value={data.snapshot.platform} />
          <Stat label="Process uptime" value={data.snapshot.uptime} />
          <Stat label="Resident memory" value={data.snapshot.memory} />
          <Stat label="Package" value={data.snapshot.package} />
          <Stat label="Dependencies" value={String(data.snapshot.dependencies)} />
        </dl>
      </Card>

      <Card title="What the loader did" class="mt-6">
        <ul class="space-y-4">
          {data.activity.map((item) => (
            <li class="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <span>{item.label}</span>
              <Code>{item.source}</Code>
            </li>
          ))}
        </ul>
      </Card>

      <p class="mt-6 text-sm leading-6 text-zinc-500">
        Refresh or navigate away and back to run the async loader again. The module under <Code>_lib/server.ts</Code> is never part of Brandy's browser runtime.
      </p>
    </main>
  );
}

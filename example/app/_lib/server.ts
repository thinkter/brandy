import { hostname, platform } from "node:os";
import { memoizeLoader } from "brandy";
import packageManifest from "../../../package.json" with { type: "json" };

export const getServerSnapshot = memoizeLoader(async () => {
  const memory = process.memoryUsage();

  return {
    sampleId: crypto.randomUUID().slice(0, 8),
    runtime: `Node ${process.version}`,
    platform: `${platform()} / ${process.arch}`,
    host: hostname(),
    uptime: formatDuration(process.uptime()),
    memory: `${Math.round(memory.rss / 1024 / 1024)} MB`,
    package: `${packageManifest.name}@${packageManifest.version}`,
    dependencies: Object.keys(packageManifest.dependencies).length,
    renderedAt: new Date().toISOString(),
  };
});

export async function getServerActivity() {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 20);
  await promise;
  return [
    { label: "Inlined package manifest at build time", source: "import … with { type: 'json' }" },
    { label: "Inspected process memory", source: "process.memoryUsage()" },
    { label: "Resolved host platform", source: "node:os" },
  ];
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

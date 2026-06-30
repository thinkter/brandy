import { readFile, stat } from "node:fs/promises";
import { hostname, platform } from "node:os";

const packageFile = new URL("../../../package.json", import.meta.url);

export async function getServerSnapshot() {
  const [source, details] = await Promise.all([
    readFile(packageFile, "utf8"),
    stat(packageFile),
  ]);
  const manifest = JSON.parse(source) as { name: string; version: string; dependencies: Record<string, string> };
  const memory = process.memoryUsage();

  return {
    runtime: `Bun ${Bun.version}`,
    platform: `${platform()} / ${process.arch}`,
    host: hostname(),
    uptime: formatDuration(process.uptime()),
    memory: `${Math.round(memory.rss / 1024 / 1024)} MB`,
    package: `${manifest.name}@${manifest.version}`,
    dependencies: Object.keys(manifest.dependencies).length,
    manifestUpdatedAt: details.mtime.toISOString(),
    renderedAt: new Date().toISOString(),
  };
}

export async function getServerActivity() {
  await Bun.sleep(20);
  return [
    { label: "Read package manifest", source: "node:fs/promises" },
    { label: "Inspected process memory", source: "process.memoryUsage()" },
    { label: "Resolved host platform", source: "node:os" },
  ];
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

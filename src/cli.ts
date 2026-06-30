#!/usr/bin/env bun
import { join } from "node:path";
import { buildApplication } from "./build.ts";
import { runDev } from "./dev.ts";
import { latestMtime, loadConfig } from "./tooling.ts";

function usage(): never {
  console.error("Usage: brandy <dev|build|start> [--host <host>] [--port <port>]");
  process.exit(1);
}

function flags(args: string[]): { host?: string; port?: number } {
  const result: { host?: string; port?: number } = {};
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1]; if (!value) usage();
    if (args[index] === "--host") result.host = value;
    else if (args[index] === "--port" && Number.isInteger(Number(value))) result.port = Number(value);
    else usage();
  }
  return result;
}

const [command, ...args] = Bun.argv.slice(2);
if (!command || !["dev", "build", "start"].includes(command)) usage();
const config = await loadConfig(); const cli = flags(args);
config.host = cli.host ?? process.env.HOST ?? config.host;
config.port = cli.port ?? (process.env.PORT ? Number(process.env.PORT) : config.port);
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error(`Invalid port: ${config.port}`);

if (command === "dev") await runDev(config);
if (command === "build") {
  await buildApplication(config);
  console.log(`Brandy built ${config.outDir}`);
}
if (command === "start") {
  const server = join(config.outDir, "server.js"); const metadata = Bun.file(join(config.outDir, "build.json"));
  if (!await Bun.file(server).exists() || !await metadata.exists()) throw new Error("No Brandy build found. Run `brandy build` first.");
  const build = await metadata.json() as { sourceMtime: number };
  const current = await latestMtime([config.appDir, config.styles, config.publicDir, config.configFile]);
  if (current > build.sourceMtime + 1) throw new Error("The Brandy build is stale. Run `brandy build` again.");
  const child = Bun.spawn([process.execPath, server], { stdin: "inherit", stdout: "inherit", stderr: "inherit", env: { ...process.env, PORT: String(config.port), HOST: config.host } });
  process.exit(await child.exited);
}

#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { loadDatabaseConfig } from "./config/loader.js";
import { ConnectionRegistry } from "./connections/registry.js";
import { createServer } from "./mcp/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveConfigPath(): string {
  if (process.env.DATABASES_CONFIG_PATH) {
    return process.env.DATABASES_CONFIG_PATH;
  }
  const cwdYml = join(process.cwd(), "databases.config.yml");
  if (existsSync(cwdYml)) return cwdYml;

  const cwdConfigYml = join(process.cwd(), "config", "databases.config.yml");
  if (existsSync(cwdConfigYml)) return cwdConfigYml;

  return join(__dirname, "..", "config", "databases.config.yml");
}

async function main(): Promise<void> {
  const configPath = resolveConfigPath();
  const entries = loadDatabaseConfig(configPath);

  const registry = new ConnectionRegistry(entries, configPath);
  const server = createServer(registry);

  const shutdown = async (): Promise<void> => {
    await registry.closeAll();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  // Tools are registered above; connections start in the background and never block startup.
  registry.startAll();
  // Self-heal connections that gave up retrying (e.g. a tunnel wasn't up yet)
  // instead of leaving them dead until a tool call happens to poke them.
  registry.startHealthSweep();

  await server.start({ transportType: "stdio" });
}

main().catch((err) => {
  console.error("Fatal error starting mcp-server-db:", err);
  process.exit(1);
});

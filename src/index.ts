import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadDatabaseConfig } from "./config/loader.js";
import { ConnectionRegistry } from "./connections/registry.js";
import { createServer } from "./mcp/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const configPath = process.env.DATABASES_CONFIG_PATH ?? join(__dirname, "..", "config", "databases.config.yml");
  const entries = loadDatabaseConfig(configPath);

  const registry = new ConnectionRegistry(entries);
  const server = createServer(registry);

  // Tools are registered above; connections start in the background and never block startup.
  registry.startAll();

  await server.start({ transportType: "stdio" });
}

main().catch((err) => {
  console.error("Fatal error starting mcp-database-server:", err);
  process.exit(1);
});

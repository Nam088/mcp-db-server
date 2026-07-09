import { FastMCP } from "fastmcp";
import type { ConnectionRegistry } from "../connections/registry.js";
import { registerStatusTools } from "../tools/status-tools.js";
import { registerPostgresTools } from "../tools/postgres-tools.js";
import { registerRedisTools } from "../tools/redis-tools.js";

export function createServer(registry: ConnectionRegistry): FastMCP {
  const server = new FastMCP({
    name: "mcp-database-server",
    version: "0.1.0",
  });

  registerStatusTools(server, registry);
  registerPostgresTools(server, registry);
  registerRedisTools(server, registry);

  return server;
}

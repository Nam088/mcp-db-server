import { FastMCP } from "fastmcp";
import type { ConnectionRegistry } from "../connections/registry.js";
import { registerStatusTools } from "../tools/status-tools.js";
import { registerPostgresTools } from "../tools/postgres-tools.js";
import { registerRedisTools } from "../tools/redis-tools.js";
import { registerElasticsearchTools } from "../tools/elasticsearch-tools.js";
import { registerMySqlTools } from "../tools/mysql-tools.js";
import { registerMongoDbTools } from "../tools/mongodb-tools.js";

export function createServer(registry: ConnectionRegistry): FastMCP {
  const server = new FastMCP({
    name: "mcp-server-db",
    version: "0.1.0",
  });

  registerStatusTools(server, registry);
  registerPostgresTools(server, registry);
  registerRedisTools(server, registry);
  registerElasticsearchTools(server, registry);
  registerMySqlTools(server, registry);
  registerMongoDbTools(server, registry);

  return server;
}


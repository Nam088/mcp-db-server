import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { ConnectionRegistry } from "../connections/registry.js";
import { resolveConnection, requireWritable, throwUnavailable } from "./connection-helpers.js";

const connectionIdParam = z
  .string()
  .optional()
  .describe(
    "Id of the redis connection to use, from databases.config.yml. Optional when only one redis connection is configured.",
  );

export function registerRedisTools(server: FastMCP, registry: ConnectionRegistry): void {
  server.addTool({
    name: "redis_get",
    description: "Get the value stored at a Redis key.",
    parameters: z.object({ key: z.string(), connectionId: connectionIdParam }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const value = await result.client.get(key);
      return value ?? "";
    },
  });

  server.addTool({
    name: "redis_set",
    description: "Set a Redis key to a value. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({ key: z.string(), value: z.string(), connectionId: connectionIdParam }),
    execute: async ({ key, value, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      return await result.client.set(key, value);
    },
  });

  server.addTool({
    name: "redis_del",
    description: "Delete a Redis key. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({ key: z.string(), connectionId: connectionIdParam }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const deleted = await result.client.del(key);
      return String(deleted);
    },
  });

  server.addTool({
    name: "redis_keys",
    description: "List Redis keys matching a glob pattern (e.g. 'user:*').",
    parameters: z.object({ pattern: z.string(), connectionId: connectionIdParam }),
    execute: async ({ pattern, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const keys = await result.client.keys(pattern);
      return JSON.stringify(keys);
    },
  });

  server.addTool({
    name: "redis_ttl",
    description: "Get the remaining time to live (in seconds) of a Redis key, or -1 if it has none.",
    parameters: z.object({ key: z.string(), connectionId: connectionIdParam }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const ttl = await result.client.ttl(key);
      return String(ttl);
    },
  });
}

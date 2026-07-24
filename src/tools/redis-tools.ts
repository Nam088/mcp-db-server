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

// KEYS/SMEMBERS/LRANGE have no server-side limit and can return an unbounded amount of
// data on a large keyspace/set/list; cap what we return so one call can't OOM this
// process or ship a huge payload back to the caller.
const MAX_RESULT_ITEMS = 1000;

function withResultCap(items: string[]): string {
  if (items.length <= MAX_RESULT_ITEMS) {
    return JSON.stringify(items);
  }
  return JSON.stringify({
    items: items.slice(0, MAX_RESULT_ITEMS),
    truncated: true,
    returned: MAX_RESULT_ITEMS,
    total: items.length,
  });
}

export function registerRedisTools(server: FastMCP, registry: ConnectionRegistry): void {
  server.addTool({
    name: "redis_get",
    description: "Get the value stored at a Redis key.",
    parameters: z.object({ key: z.string(), connectionId: connectionIdParam }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
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
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      return await result.client.set(key, value);
    },
  });

  server.addTool({
    name: "redis_mset",
    description:
      "Set multiple string keys to their values in a single command (e.g. for seeding test/sample data) — far more efficient than one redis_set call per key. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      entries: z.string().describe('JSON object of key/value pairs to set, e.g. \'{"user:1:name":"Alice","user:2:name":"Bob"}\''),
      connectionId: connectionIdParam,
    }),
    execute: async ({ entries, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const parsed = JSON.parse(entries) as Record<string, string>;
      const count = Object.keys(parsed).length;
      if (count === 0) {
        return JSON.stringify({ success: true, count: 0 });
      }
      await result.client.mset(parsed);
      return JSON.stringify({ success: true, count });
    },
  });

  server.addTool({
    name: "redis_del",
    description: "Delete a Redis key. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({ key: z.string(), connectionId: connectionIdParam }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const deleted = await result.client.del(key);
      return String(deleted);
    },
  });

  server.addTool({
    name: "redis_keys",
    description: "List Redis keys matching a glob pattern (e.g. 'user:*'). Capped at 1000 keys; result is truncated=true with a total count if there are more.",
    parameters: z.object({ pattern: z.string(), connectionId: connectionIdParam }),
    execute: async ({ pattern, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const keys = await result.client.keys(pattern);
      return withResultCap(keys);
    },
  });

  server.addTool({
    name: "redis_ttl",
    description: "Get the remaining time to live (in seconds) of a Redis key, or -1 if it has none.",
    parameters: z.object({ key: z.string(), connectionId: connectionIdParam }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const ttl = await result.client.ttl(key);
      return String(ttl);
    },
  });

  server.addTool({
    name: "redis_hget",
    description: "Get the value of a hash field.",
    parameters: z.object({
      key: z.string(),
      field: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, field, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const val = await result.client.hget(key, field);
      return val ?? "";
    },
  });

  server.addTool({
    name: "redis_hset",
    description: "Set the value of a hash field. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      key: z.string(),
      field: z.string(),
      value: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, field, value, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.hset(key, field, value);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_hdel",
    description: "Delete one or more hash fields. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      key: z.string(),
      field: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, field, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.hdel(key, field);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_hgetall",
    description: "Get all fields and values of a hash.",
    parameters: z.object({
      key: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const data = await result.client.hgetall(key);
      return JSON.stringify(data);
    },
  });

  server.addTool({
    name: "redis_hexists",
    description: "Check if a hash field exists.",
    parameters: z.object({
      key: z.string(),
      field: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, field, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.hexists(key, field);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_sadd",
    description: "Add a member to a set. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      key: z.string(),
      member: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, member, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.sadd(key, member);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_srem",
    description: "Remove a member from a set. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      key: z.string(),
      member: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, member, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.srem(key, member);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_smembers",
    description: "Get all members of a set. Capped at 1000 members; result is truncated=true with a total count if there are more.",
    parameters: z.object({
      key: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const members = await result.client.smembers(key);
      return withResultCap(members);
    },
  });

  server.addTool({
    name: "redis_sismember",
    description: "Check if a value is a member of a set.",
    parameters: z.object({
      key: z.string(),
      member: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, member, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.sismember(key, member);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_lpush",
    description: "Prepend a value to a list. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      key: z.string(),
      value: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, value, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.lpush(key, value);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_rpush",
    description: "Append a value to a list. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      key: z.string(),
      value: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, value, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.rpush(key, value);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_lpop",
    description: "Remove and return the first element of a list. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      key: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const val = await result.client.lpop(key);
      return val ?? "";
    },
  });

  server.addTool({
    name: "redis_rpop",
    description: "Remove and return the last element of a list. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      key: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const val = await result.client.rpop(key);
      return val ?? "";
    },
  });

  server.addTool({
    name: "redis_lrange",
    description: "Get a range of elements from a list. Capped at 1000 elements; result is truncated=true with a total count if there are more.",
    parameters: z.object({
      key: z.string(),
      start: z.number().int().describe("Start index (0-based)"),
      stop: z.number().int().describe("Stop index (0-based, inclusive, or -1 for end)"),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, start, stop, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const range = await result.client.lrange(key, start, stop);
      return withResultCap(range);
    },
  });

  server.addTool({
    name: "redis_llen",
    description: "Get the length of a list.",
    parameters: z.object({
      key: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const len = await result.client.llen(key);
      return String(len);
    },
  });

  server.addTool({
    name: "redis_exists",
    description: "Check key existence.",
    parameters: z.object({
      key: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.exists(key);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_expire",
    description: "Set a key's time to live in seconds. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      key: z.string(),
      seconds: z.number().int().nonnegative().describe("Time to live in seconds"),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, seconds, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.expire(key, seconds);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_type",
    description: "Retrieve the internal data type of a key.",
    parameters: z.object({
      key: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const t = await result.client.type(key);
      return t;
    },
  });

  server.addTool({
    name: "redis_incr",
    description: "Increment the integer value of a key. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      key: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.incr(key);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_decr",
    description: "Decrement the integer value of a key. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      key: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ key, connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const num = await result.client.decr(key);
      return String(num);
    },
  });

  server.addTool({
    name: "redis_flushdb",
    description: "Delete all keys from the current database. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      connectionId: connectionIdParam,
    }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "redis", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const res = await result.client.flushdb();
      return res;
    },
  });
}

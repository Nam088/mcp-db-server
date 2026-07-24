import { describe, it, expect } from "vitest";
import { UserError } from "fastmcp";
import { registerRedisTools } from "../../src/tools/redis-tools.js";

class FakeServer {
  public tools: Record<string, { execute: (args: never) => Promise<string> }> = {};
  addTool(def: { name: string; execute: (args: never) => Promise<string> }): void {
    this.tools[def.name] = def;
  }
}

function makeFakeRegistry(readOnly: boolean, getClientResult: unknown) {
  const conn = { id: "cache", type: "redis", readOnly, getClient: () => getClientResult };
  return {
    get: () => conn,
    findOneByType: () => conn,
    countByType: () => 1,
  };
}

describe("redis tools", () => {
  it("redis_get returns the value for a key", async () => {
    const client = { get: async (key: string) => `value-for-${key}` };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_get.execute({ key: "foo" } as never);
    expect(result).toBe("value-for-foo");
  });

  it("redis_get throws UserError with the connection status when unavailable", async () => {
    const status = { id: "cache", type: "redis", state: "circuit_open" as const, readOnly: true };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: false, status }) as never);

    await expect(server.tools.redis_get.execute({ key: "foo" } as never)).rejects.toThrow(UserError);
  });

  it("redis_set refuses to run when the resolved connection's readOnly is true", async () => {
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);

    await expect(server.tools.redis_set.execute({ key: "foo", value: "bar" } as never)).rejects.toThrow(
      /READ_ONLY/,
    );
  });

  it("redis_set runs when the resolved connection's readOnly is false", async () => {
    const setCalls: Array<[string, string]> = [];
    const client = {
      set: async (key: string, value: string) => {
        setCalls.push([key, value]);
        return "OK";
      },
    };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(false, { ok: true, client }) as never);

    const result = await server.tools.redis_set.execute({ key: "foo", value: "bar" } as never);
    expect(result).toBe("OK");
    expect(setCalls).toEqual([["foo", "bar"]]);
  });

  it("redis_mset refuses to run when the resolved connection's readOnly is true", async () => {
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);

    await expect(server.tools.redis_mset.execute({ entries: '{"a":"1"}' } as never)).rejects.toThrow(/READ_ONLY/);
  });

  it("redis_mset sets every key/value pair in one call when writable", async () => {
    const msetCalls: Array<Record<string, string>> = [];
    const client = {
      mset: async (obj: Record<string, string>) => {
        msetCalls.push(obj);
        return "OK";
      },
    };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(false, { ok: true, client }) as never);

    const result = await server.tools.redis_mset.execute({
      entries: '{"user:1:name":"Alice","user:2:name":"Bob"}',
    } as never);

    expect(JSON.parse(result)).toEqual({ success: true, count: 2 });
    expect(msetCalls).toEqual([{ "user:1:name": "Alice", "user:2:name": "Bob" }]);
  });

  it("redis_mset is a no-op and does not call mset when entries is an empty object", async () => {
    const msetCalls: unknown[] = [];
    const client = { mset: async (obj: unknown) => msetCalls.push(obj) };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(false, { ok: true, client }) as never);

    const result = await server.tools.redis_mset.execute({ entries: "{}" } as never);

    expect(JSON.parse(result)).toEqual({ success: true, count: 0 });
    expect(msetCalls).toHaveLength(0);
  });

  it("redis_keys returns matching keys for a pattern", async () => {
    const client = { keys: async (pattern: string) => [`${pattern}-1`, `${pattern}-2`] };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_keys.execute({ pattern: "user:*" } as never);
    expect(JSON.parse(result)).toEqual(["user:*-1", "user:*-2"]);
  });

  it("redis_keys caps the result and reports truncation when there are more than 1000 matches", async () => {
    const allKeys = Array.from({ length: 1500 }, (_, i) => `key-${i}`);
    const client = { keys: async () => allKeys };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_keys.execute({ pattern: "*" } as never);
    const parsed = JSON.parse(result);
    expect(parsed.truncated).toBe(true);
    expect(parsed.returned).toBe(1000);
    expect(parsed.total).toBe(1500);
    expect(parsed.items).toHaveLength(1000);
  });

  it("redis_hget returns hash field value", async () => {
    const client = { hget: async (key: string, field: string) => `value-${key}-${field}` };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_hget.execute({ key: "myhash", field: "myfield" } as never);
    expect(result).toBe("value-myhash-myfield");
  });

  it("redis_hset sets hash field value and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_hset.execute({ key: "h", field: "f", value: "v" } as never)).rejects.toThrow(/READ_ONLY/);

    const client = { hset: async (key: string, field: string, value: string) => 1 };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_hset.execute({ key: "h", field: "f", value: "v" } as never);
    expect(result).toBe("1");
  });

  it("redis_hdel deletes hash field and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_hdel.execute({ key: "h", field: "f" } as never)).rejects.toThrow(/READ_ONLY/);

    const client = { hdel: async (key: string, field: string) => 1 };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_hdel.execute({ key: "h", field: "f" } as never);
    expect(result).toBe("1");
  });

  it("redis_hgetall returns hash object", async () => {
    const client = { hgetall: async (key: string) => ({ f1: "v1", f2: "v2" }) };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_hgetall.execute({ key: "myhash" } as never);
    expect(JSON.parse(result)).toEqual({ f1: "v1", f2: "v2" });
  });

  it("redis_hexists returns if hash field exists", async () => {
    const client = { hexists: async (key: string, field: string) => 1 };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_hexists.execute({ key: "myhash", field: "myfield" } as never);
    expect(result).toBe("1");
  });

  it("redis_sadd adds member to set and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_sadd.execute({ key: "s", member: "m" } as never)).rejects.toThrow(/READ_ONLY/);

    const client = { sadd: async (key: string, member: string) => 1 };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_sadd.execute({ key: "s", member: "m" } as never);
    expect(result).toBe("1");
  });

  it("redis_srem removes member from set and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_srem.execute({ key: "s", member: "m" } as never)).rejects.toThrow(/READ_ONLY/);

    const client = { srem: async (key: string, member: string) => 1 };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_srem.execute({ key: "s", member: "m" } as never);
    expect(result).toBe("1");
  });

  it("redis_smembers returns all set members", async () => {
    const client = { smembers: async (key: string) => ["m1", "m2"] };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_smembers.execute({ key: "myset" } as never);
    expect(JSON.parse(result)).toEqual(["m1", "m2"]);
  });

  it("redis_smembers caps the result when the set is huge", async () => {
    const client = { smembers: async () => Array.from({ length: 1200 }, (_, i) => `m${i}`) };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_smembers.execute({ key: "myset" } as never);
    const parsed = JSON.parse(result);
    expect(parsed.truncated).toBe(true);
    expect(parsed.total).toBe(1200);
  });

  it("redis_sismember returns set member check status", async () => {
    const client = { sismember: async (key: string, member: string) => 1 };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_sismember.execute({ key: "myset", member: "m1" } as never);
    expect(result).toBe("1");
  });

  it("redis_lpush prepends value to list and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_lpush.execute({ key: "l", value: "v" } as never)).rejects.toThrow(/READ_ONLY/);

    const client = { lpush: async (key: string, value: string) => 1 };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_lpush.execute({ key: "l", value: "v" } as never);
    expect(result).toBe("1");
  });

  it("redis_rpush appends value to list and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_rpush.execute({ key: "l", value: "v" } as never)).rejects.toThrow(/READ_ONLY/);

    const client = { rpush: async (key: string, value: string) => 1 };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_rpush.execute({ key: "l", value: "v" } as never);
    expect(result).toBe("1");
  });

  it("redis_lpop pops value from list and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_lpop.execute({ key: "l" } as never)).rejects.toThrow(/READ_ONLY/);

    const client = { lpop: async (key: string) => "v" };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_lpop.execute({ key: "l" } as never);
    expect(result).toBe("v");
  });

  it("redis_rpop pops value from list and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_rpop.execute({ key: "l" } as never)).rejects.toThrow(/READ_ONLY/);

    const client = { rpop: async (key: string) => "v" };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_rpop.execute({ key: "l" } as never);
    expect(result).toBe("v");
  });

  it("redis_lrange returns range from list", async () => {
    const client = { lrange: async (key: string, start: number, stop: number) => ["v1", "v2"] };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_lrange.execute({ key: "mylist", start: 0, stop: 1 } as never);
    expect(JSON.parse(result)).toEqual(["v1", "v2"]);
  });

  it("redis_lrange caps the result when the requested range is huge", async () => {
    const client = { lrange: async () => Array.from({ length: 2000 }, (_, i) => `v${i}`) };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_lrange.execute({ key: "mylist", start: 0, stop: -1 } as never);
    const parsed = JSON.parse(result);
    expect(parsed.truncated).toBe(true);
    expect(parsed.total).toBe(2000);
  });

  it("redis_llen returns length of list", async () => {
    const client = { llen: async (key: string) => 5 };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_llen.execute({ key: "mylist" } as never);
    expect(result).toBe("5");
  });

  it("redis_exists returns if key exists", async () => {
    const client = { exists: async (key: string) => 1 };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_exists.execute({ key: "mykey" } as never);
    expect(result).toBe("1");
  });

  it("redis_expire sets expire and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_expire.execute({ key: "k", seconds: 10 } as never)).rejects.toThrow(/READ_ONLY/);

    const client = { expire: async (key: string, seconds: number) => 1 };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_expire.execute({ key: "k", seconds: 10 } as never);
    expect(result).toBe("1");
  });

  it("redis_type returns data type of key", async () => {
    const client = { type: async (key: string) => "string" };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_type.execute({ key: "mykey" } as never);
    expect(result).toBe("string");
  });

  it("redis_incr increments key and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_incr.execute({ key: "k" } as never)).rejects.toThrow(/READ_ONLY/);

    const client = { incr: async (key: string) => 10 };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_incr.execute({ key: "k" } as never);
    expect(result).toBe("10");
  });

  it("redis_decr decrements key and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_decr.execute({ key: "k" } as never)).rejects.toThrow(/READ_ONLY/);

    const client = { decr: async (key: string) => 8 };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_decr.execute({ key: "k" } as never);
    expect(result).toBe("8");
  });

  it("redis_flushdb flushes database and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerRedisTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.redis_flushdb.execute({} as never)).rejects.toThrow(/READ_ONLY/);

    const client = { flushdb: async () => "OK" };
    const serverWritable = new FakeServer();
    registerRedisTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.redis_flushdb.execute({} as never);
    expect(result).toBe("OK");
  });
});


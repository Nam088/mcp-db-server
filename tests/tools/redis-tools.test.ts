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

  it("redis_keys returns matching keys for a pattern", async () => {
    const client = { keys: async (pattern: string) => [`${pattern}-1`, `${pattern}-2`] };
    const server = new FakeServer();
    registerRedisTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.redis_keys.execute({ pattern: "user:*" } as never);
    expect(JSON.parse(result)).toEqual(["user:*-1", "user:*-2"]);
  });
});

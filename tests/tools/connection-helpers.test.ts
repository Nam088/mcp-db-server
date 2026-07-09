import { describe, it, expect } from "vitest";
import { UserError } from "fastmcp";
import { resolveConnection, requireWritable } from "../../src/tools/connection-helpers.js";

function makeFakeRegistry(connections: Array<{ id: string; type: string }>) {
  return {
    get: (id: string) => connections.find((c) => c.id === id),
    findOneByType: (type: string) => {
      const matches = connections.filter((c) => c.type === type);
      return matches.length === 1 ? matches[0] : undefined;
    },
    countByType: (type: string) => connections.filter((c) => c.type === type).length,
  };
}

describe("resolveConnection", () => {
  it("returns the single connection of the requested type when no id is given", () => {
    const registry = makeFakeRegistry([{ id: "primary-pg", type: "postgres" }]);
    const conn = resolveConnection(registry as never, "postgres");
    expect(conn.id).toBe("primary-pg");
  });

  it("returns the connection matching an explicit id", () => {
    const registry = makeFakeRegistry([
      { id: "pg-a", type: "postgres" },
      { id: "pg-b", type: "postgres" },
    ]);
    const conn = resolveConnection(registry as never, "postgres", "pg-b");
    expect(conn.id).toBe("pg-b");
  });

  it("throws UserError when zero connections of the type are configured", () => {
    const registry = makeFakeRegistry([]);
    expect(() => resolveConnection(registry as never, "postgres")).toThrow(UserError);
  });

  it("throws UserError when multiple connections match and no id was given", () => {
    const registry = makeFakeRegistry([
      { id: "pg-a", type: "postgres" },
      { id: "pg-b", type: "postgres" },
    ]);
    expect(() => resolveConnection(registry as never, "postgres")).toThrow(UserError);
  });

  it("throws UserError when the resolved connection's type does not match", () => {
    const registry = makeFakeRegistry([{ id: "cache", type: "redis" }]);
    expect(() => resolveConnection(registry as never, "postgres", "cache")).toThrow(UserError);
  });
});

describe("requireWritable", () => {
  it("does not throw for a connection whose readOnly is false", () => {
    expect(() => requireWritable({ id: "pg-a", readOnly: false } as never)).not.toThrow();
  });

  it("throws with a message naming the connection when readOnly is true", () => {
    expect(() => requireWritable({ id: "pg-a", readOnly: true } as never)).toThrow(/pg-a.*READ_ONLY|READ_ONLY.*pg-a/);
  });
});

import { describe, it, expect, vi } from "vitest";

vi.mock("pg", () => ({
  Pool: vi.fn().mockImplementation(() => ({ query: vi.fn().mockResolvedValue({ rows: [] }), on: vi.fn() })),
}));
vi.mock("ioredis", () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue("PONG"),
    on: vi.fn(),
  }));
  return { default: RedisMock, Redis: RedisMock };
});

const { ConnectionRegistry } = await import("../../src/connections/registry.js");

describe("ConnectionRegistry", () => {
  it("builds connections from config entries, preserving id, type, and readOnly", () => {
    const registry = new ConnectionRegistry([
      { id: "primary-pg", type: "postgres", connectionString: "postgres://x", readOnly: true },
      { id: "cache", type: "redis", connectionString: "redis://x", readOnly: false },
    ]);

    expect(registry.get("primary-pg")?.type).toBe("postgres");
    expect(registry.get("primary-pg")?.readOnly).toBe(true);
    expect(registry.get("cache")?.type).toBe("redis");
    expect(registry.get("cache")?.readOnly).toBe(false);
    expect(registry.get("missing")).toBeUndefined();
    expect(registry.countByType("postgres")).toBe(1);
    expect(registry.findOneByType("postgres")?.id).toBe("primary-pg");
  });

  it("supports multiple connections of the same type with independent readOnly modes", () => {
    const registry = new ConnectionRegistry([
      { id: "pg-a", type: "postgres", connectionString: "postgres://a", readOnly: true },
      { id: "pg-b", type: "postgres", connectionString: "postgres://b", readOnly: false },
    ]);

    expect(registry.countByType("postgres")).toBe(2);
    expect(registry.findOneByType("postgres")).toBeUndefined();
    expect(registry.get("pg-a")?.readOnly).toBe(true);
    expect(registry.get("pg-b")?.readOnly).toBe(false);
  });

  it("lists a status entry for every configured connection", () => {
    const registry = new ConnectionRegistry([
      { id: "primary-pg", type: "postgres", connectionString: "postgres://x", readOnly: true },
      { id: "cache", type: "redis", connectionString: "redis://x", readOnly: false },
    ]);

    const statuses = registry.listStatuses();
    expect(statuses.map((s) => s.id).sort()).toEqual(["cache", "primary-pg"]);
    expect(statuses.every((s) => s.state === "idle")).toBe(true);
  });
});

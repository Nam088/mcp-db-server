import { describe, it, expect, vi } from "vitest";

vi.mock("pg", () => ({
  Pool: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  })),
}));
vi.mock("ioredis", () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue("PONG"),
    quit: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { default: RedisMock, Redis: RedisMock };
});
vi.mock("@elastic/elasticsearch", () => {
  const ClientMock = vi.fn().mockImplementation(() => ({
    ping: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  }));
  return { Client: ClientMock };
});
vi.mock("es7-client", () => {
  const ClientMock = vi.fn().mockImplementation(() => ({
    ping: vi.fn().mockResolvedValue({ body: true }),
    close: vi.fn().mockResolvedValue(undefined),
  }));
  return { Client: ClientMock };
});

const loadDatabaseConfigMock = vi.fn();
vi.mock("../../src/config/loader.js", () => ({
  loadDatabaseConfig: loadDatabaseConfigMock,
}));

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

  it("builds an elasticsearch connection from a config entry", () => {
    const registry = new ConnectionRegistry([
      { id: "logs-es", type: "elasticsearch", connectionString: "http://x:9200", readOnly: true },
    ]);

    expect(registry.get("logs-es")?.type).toBe("elasticsearch");
    expect(registry.get("logs-es")?.readOnly).toBe(true);
    expect(registry.countByType("elasticsearch")).toBe(1);
  });

  it("builds an ldap connection from a config entry", () => {
    const registry = new ConnectionRegistry([
      {
        id: "directory",
        type: "ldap",
        connectionString: "ldap://x:389",
        readOnly: true,
        bindDn: "cn=admin,dc=example,dc=com",
        bindPassword: "secret",
      },
    ]);

    expect(registry.get("directory")?.type).toBe("ldap");
    expect(registry.get("directory")?.readOnly).toBe(true);
    expect(registry.countByType("ldap")).toBe(1);
  });

  it("reload() rebuilds an elasticsearch connection when only its apiVersion changes", async () => {
    const registry = new ConnectionRegistry(
      [{ id: "logs-es", type: "elasticsearch", connectionString: "http://x:9200", readOnly: true }],
      "/config/databases.config.yml",
    );

    const originalConn = registry.get("logs-es");

    loadDatabaseConfigMock.mockReturnValue([
      { id: "logs-es", type: "elasticsearch", connectionString: "http://x:9200", readOnly: true, apiVersion: "7" },
    ]);
    await registry.reload();

    expect(registry.get("logs-es")).not.toBe(originalConn);
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

  it("reload() leaves unchanged connections untouched and only rebuilds changed/added/removed ones", async () => {
    const registry = new ConnectionRegistry(
      [
        { id: "primary-pg", type: "postgres", connectionString: "postgres://x", readOnly: true },
        { id: "cache", type: "redis", connectionString: "redis://x", readOnly: false },
      ],
      "/config/databases.config.yml",
    );

    const untouchedConn = registry.get("primary-pg");
    const replacedConn = registry.get("cache");

    loadDatabaseConfigMock.mockReturnValue([
      { id: "primary-pg", type: "postgres", connectionString: "postgres://x", readOnly: true },
      { id: "cache", type: "redis", connectionString: "redis://changed", readOnly: false },
      { id: "extra", type: "redis", connectionString: "redis://y", readOnly: true },
    ]);

    await registry.reload();

    expect(registry.get("primary-pg")).toBe(untouchedConn);
    expect(registry.get("cache")).not.toBe(replacedConn);
    expect(registry.get("extra")).toBeDefined();
    expect(registry.countByType("redis")).toBe(2);
  });

  it("reload() stops and drops connections removed from the config", async () => {
    const registry = new ConnectionRegistry(
      [{ id: "primary-pg", type: "postgres", connectionString: "postgres://x", readOnly: true }],
      "/config/databases.config.yml",
    );

    loadDatabaseConfigMock.mockReturnValue([]);
    await registry.reload();

    expect(registry.get("primary-pg")).toBeUndefined();
  });

  it("rejects a reload() call while one is already in progress", async () => {
    const registry = new ConnectionRegistry(
      [{ id: "primary-pg", type: "postgres", connectionString: "postgres://x", readOnly: true }],
      "/config/databases.config.yml",
    );

    loadDatabaseConfigMock.mockReturnValue([
      { id: "primary-pg", type: "postgres", connectionString: "postgres://changed", readOnly: true },
    ]);

    const first = registry.reload();
    await expect(registry.reload()).rejects.toThrow(/already in progress/);
    await first;
  });

  it("throws when reload() is called without a configPath", async () => {
    const registry = new ConnectionRegistry([
      { id: "primary-pg", type: "postgres", connectionString: "postgres://x", readOnly: true },
    ]);

    await expect(registry.reload()).rejects.toThrow(/No configPath/);
  });
});

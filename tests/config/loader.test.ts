import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDatabaseConfig } from "../../src/config/loader.js";

const tmpConfigPath = join(tmpdir(), `databases.config.${process.pid}.yml`);

afterEach(() => {
  if (existsSync(tmpConfigPath)) rmSync(tmpConfigPath);
  delete process.env.POSTGRES_URL;
  delete process.env.REDIS_URL;
  delete process.env.ELASTICSEARCH_URL;
  delete process.env.POSTGRES_READ_ONLY;
  delete process.env.REDIS_READ_ONLY;
  delete process.env.ELASTICSEARCH_READ_ONLY;
  delete process.env.ELASTICSEARCH_API_VERSION;
  delete process.env.TEST_PG_URL;
});

describe("loadDatabaseConfig", () => {
  it("parses a config file, expands ${ENV_VAR} references, and reads a per-connection readOnly flag", () => {
    process.env.TEST_PG_URL = "postgresql://from-env/db";
    writeFileSync(
      tmpConfigPath,
      [
        "connections:",
        "  - id: primary-pg",
        "    type: postgres",
        "    connectionString: ${TEST_PG_URL}",
        "    readOnly: true",
        "  - id: cache",
        "    type: redis",
        "    connectionString: redis://literal:6379",
        "    readOnly: false",
      ].join("\n"),
    );

    const entries = loadDatabaseConfig(tmpConfigPath);
    expect(entries).toEqual([
      { id: "primary-pg", type: "postgres", connectionString: "postgresql://from-env/db", readOnly: true },
      { id: "cache", type: "redis", connectionString: "redis://literal:6379", readOnly: false },
    ]);
  });

  it("defaults readOnly to true in a config file when the field is omitted", () => {
    writeFileSync(
      tmpConfigPath,
      ["connections:", "  - id: primary-pg", "    type: postgres", "    connectionString: postgres://x"].join("\n"),
    );

    const entries = loadDatabaseConfig(tmpConfigPath);
    expect(entries).toEqual([{ id: "primary-pg", type: "postgres", connectionString: "postgres://x", readOnly: true }]);
  });

  it("reads a per-connection statementTimeoutMs from a config file", () => {
    writeFileSync(
      tmpConfigPath,
      [
        "connections:",
        "  - id: primary-pg",
        "    type: postgres",
        "    connectionString: postgres://x",
        "    statementTimeoutMs: 5000",
      ].join("\n"),
    );

    const entries = loadDatabaseConfig(tmpConfigPath);
    expect(entries[0].statementTimeoutMs).toBe(5000);
  });

  it("falls back to POSTGRES_URL/REDIS_URL/ELASTICSEARCH_URL and per-type *_READ_ONLY env vars when no config file exists", () => {
    process.env.POSTGRES_URL = "postgresql://localhost/db";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.ELASTICSEARCH_URL = "http://localhost:9200";
    process.env.POSTGRES_READ_ONLY = "false";
    // REDIS_READ_ONLY intentionally unset -> defaults to true
    // ELASTICSEARCH_READ_ONLY intentionally unset -> defaults to true

    const entries = loadDatabaseConfig(join(tmpdir(), "does-not-exist.yml"));
    expect(entries).toEqual([
      { id: "postgres", type: "postgres", connectionString: "postgresql://localhost/db", readOnly: false },
      { id: "redis", type: "redis", connectionString: "redis://localhost:6379", readOnly: true },
      { id: "elasticsearch", type: "elasticsearch", connectionString: "http://localhost:9200", readOnly: true },
    ]);
  });

  it("parses an elasticsearch entry from a config file", () => {
    writeFileSync(
      tmpConfigPath,
      [
        "connections:",
        "  - id: logs-es",
        "    type: elasticsearch",
        "    connectionString: http://localhost:9200",
        "    readOnly: false",
      ].join("\n"),
    );

    const entries = loadDatabaseConfig(tmpConfigPath);
    expect(entries).toEqual([
      { id: "logs-es", type: "elasticsearch", connectionString: "http://localhost:9200", readOnly: false },
    ]);
  });

  it("throws for an unsupported database type in a config file", () => {
    writeFileSync(
      tmpConfigPath,
      ["connections:", "  - id: couch", "    type: couchdb", "    connectionString: couchdb://x"].join("\n"),
    );

    expect(() => loadDatabaseConfig(tmpConfigPath)).toThrow(/Unsupported database type/);
  });

  it("reads a per-connection elasticsearch apiVersion from a config file", () => {
    writeFileSync(
      tmpConfigPath,
      [
        "connections:",
        "  - id: legacy-es",
        "    type: elasticsearch",
        "    connectionString: http://localhost:9200",
        '    apiVersion: "7"',
      ].join("\n"),
    );

    const entries = loadDatabaseConfig(tmpConfigPath);
    expect(entries[0].apiVersion).toBe("7");
  });

  it("leaves elasticsearch apiVersion undefined in a config file when omitted (ElasticsearchConnection defaults it to 9)", () => {
    writeFileSync(
      tmpConfigPath,
      ["connections:", "  - id: logs-es", "    type: elasticsearch", "    connectionString: http://localhost:9200"].join(
        "\n",
      ),
    );

    const entries = loadDatabaseConfig(tmpConfigPath);
    expect(entries[0].apiVersion).toBeUndefined();
  });

  it("throws for an unsupported elasticsearch apiVersion in a config file", () => {
    writeFileSync(
      tmpConfigPath,
      [
        "connections:",
        "  - id: logs-es",
        "    type: elasticsearch",
        "    connectionString: http://localhost:9200",
        '    apiVersion: "99"',
      ].join("\n"),
    );

    expect(() => loadDatabaseConfig(tmpConfigPath)).toThrow(/Unsupported elasticsearch apiVersion/);
  });

  it("reads ELASTICSEARCH_API_VERSION when falling back to env vars", () => {
    process.env.ELASTICSEARCH_URL = "http://localhost:9200";
    process.env.ELASTICSEARCH_API_VERSION = "7";

    const entries = loadDatabaseConfig(join(tmpdir(), "does-not-exist.yml"));
    expect(entries[0].apiVersion).toBe("7");
  });

  it("returns an empty list when no config file and no env vars are present", () => {
    const entries = loadDatabaseConfig(join(tmpdir(), "does-not-exist.yml"));
    expect(entries).toEqual([]);
  });

  it("reads POSTGRES_STATEMENT_TIMEOUT_MS as a number when falling back to env vars", () => {
    process.env.POSTGRES_URL = "postgresql://localhost/db";
    process.env.POSTGRES_STATEMENT_TIMEOUT_MS = "5000";

    const entries = loadDatabaseConfig(join(tmpdir(), "does-not-exist.yml"));
    expect(entries[0].statementTimeoutMs).toBe(5000);
    delete process.env.POSTGRES_STATEMENT_TIMEOUT_MS;
  });
});

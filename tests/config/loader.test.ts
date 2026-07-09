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
  delete process.env.POSTGRES_READ_ONLY;
  delete process.env.REDIS_READ_ONLY;
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

  it("falls back to POSTGRES_URL/REDIS_URL and per-type *_READ_ONLY env vars when no config file exists", () => {
    process.env.POSTGRES_URL = "postgresql://localhost/db";
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.POSTGRES_READ_ONLY = "false";
    // REDIS_READ_ONLY intentionally unset -> defaults to true

    const entries = loadDatabaseConfig(join(tmpdir(), "does-not-exist.yml"));
    expect(entries).toEqual([
      { id: "postgres", type: "postgres", connectionString: "postgresql://localhost/db", readOnly: false },
      { id: "redis", type: "redis", connectionString: "redis://localhost:6379", readOnly: true },
    ]);
  });

  it("returns an empty list when no config file and no env vars are present", () => {
    const entries = loadDatabaseConfig(join(tmpdir(), "does-not-exist.yml"));
    expect(entries).toEqual([]);
  });
});

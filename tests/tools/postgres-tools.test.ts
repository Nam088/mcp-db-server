import { describe, it, expect } from "vitest";
import { UserError } from "fastmcp";
import { registerPostgresTools } from "../../src/tools/postgres-tools.js";

class FakeServer {
  public tools: Record<string, { execute: (args: never) => Promise<string> }> = {};
  addTool(def: { name: string; execute: (args: never) => Promise<string> }): void {
    this.tools[def.name] = def;
  }
}

function makeFakeRegistry(readOnly: boolean, getClientResult: unknown) {
  const conn = { id: "primary-pg", type: "postgres", readOnly, getClient: () => getClientResult };
  return {
    get: () => conn,
    findOneByType: () => conn,
    countByType: () => 1,
  };
}

describe("postgres tools", () => {
  it("pg_query runs the SQL against the live client and returns rows as JSON", async () => {
    const query = async () => ({ rows: [{ id: 1 }] });
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_query.execute({ sql: "SELECT 1" } as never);
    expect(JSON.parse(result)).toEqual([{ id: 1 }]);
  });

  it("pg_query throws UserError with the connection status when the connection is unavailable", async () => {
    const status = { id: "primary-pg", type: "postgres", state: "failed" as const, readOnly: true };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: false, status }) as never);

    await expect(server.tools.pg_query.execute({ sql: "SELECT 1" } as never)).rejects.toThrow(UserError);
  });

  it("pg_execute_sql refuses to run when the resolved connection's readOnly is true", async () => {
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);

    await expect(server.tools.pg_execute_sql.execute({ sql: "DELETE FROM users" } as never)).rejects.toThrow(
      /READ_ONLY/,
    );
  });

  it("pg_execute_sql runs when the resolved connection's readOnly is false", async () => {
    const query = async () => ({ rows: [], rowCount: 0 });
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(false, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_execute_sql.execute({ sql: "DELETE FROM users" } as never);
    expect(JSON.parse(result)).toEqual({ rowCount: 0, rows: [] });
  });
});

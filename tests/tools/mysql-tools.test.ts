import { describe, it, expect, vi } from "vitest";
import { registerMySqlTools } from "../../src/tools/mysql-tools.js";

class FakeServer {
  public tools: Record<string, { execute: (args: any) => Promise<string> }> = {};
  addTool(def: { name: string; execute: (args: any) => Promise<string> }): void {
    this.tools[def.name] = def;
  }
}

describe("mysql tools", () => {
  it("mysql_query runs query when connection is connected", async () => {
    const fakeServer = new FakeServer();
    const queryMock = vi.fn().mockResolvedValue([[{ id: 1, name: "test" }]]);
    const mockConn = {
      id: "mysql1",
      type: "mysql",
      readOnly: true,
      getClient: async () => ({ ok: true, client: { query: queryMock } }),
    };

    const fakeRegistry = {
      get: (id: string) => (id === "mysql1" ? mockConn : undefined),
      findOneByType: () => mockConn,
      countByType: () => 1,
    };

    registerMySqlTools(fakeServer as never, fakeRegistry as never);

    const res = await fakeServer.tools.mysql_query.execute({ sql: "SELECT * FROM users" });
    expect(JSON.parse(res)).toEqual([{ id: 1, name: "test" }]);
    expect(queryMock).toHaveBeenCalledWith("SELECT * FROM users");
  });

  it("mysql_execute_sql blocks when connection is readOnly", async () => {
    const fakeServer = new FakeServer();
    const mockConn = {
      id: "mysql1",
      type: "mysql",
      readOnly: true,
      getClient: async () => ({ ok: true, client: {} }),
    };

    const fakeRegistry = {
      get: (id: string) => mockConn,
      findOneByType: () => mockConn,
      countByType: () => 1,
    };

    registerMySqlTools(fakeServer as never, fakeRegistry as never);

    await expect(fakeServer.tools.mysql_execute_sql.execute({ sql: "DELETE FROM users" })).rejects.toThrow(
      "READ_ONLY mode",
    );
  });
});

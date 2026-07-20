import { describe, it, expect, vi } from "vitest";
import { registerMongoDbTools } from "../../src/tools/mongodb-tools.js";

class FakeServer {
  public tools: Record<string, { execute: (args: any) => Promise<string> }> = {};
  addTool(def: { name: string; execute: (args: any) => Promise<string> }): void {
    this.tools[def.name] = def;
  }
}

describe("mongodb tools", () => {
  it("mongo_find queries documents when connected", async () => {
    const fakeServer = new FakeServer();
    const toArrayMock = vi.fn().mockResolvedValue([{ _id: "1", name: "item1" }]);
    const limitMock = vi.fn().mockReturnValue({ toArray: toArrayMock });
    const findMock = vi.fn().mockReturnValue({ limit: limitMock });
    const collectionMock = vi.fn().mockReturnValue({ find: findMock });
    const dbMock = vi.fn().mockReturnValue({ collection: collectionMock });

    const mockConn = {
      id: "mongo1",
      type: "mongodb",
      readOnly: true,
      defaultDatabase: "testdb",
      getClient: async () => ({ ok: true, client: { db: dbMock } }),
    };

    const fakeRegistry = {
      get: (id: string) => mockConn,
      findOneByType: () => mockConn,
      countByType: () => 1,
    };

    registerMongoDbTools(fakeServer as never, fakeRegistry as never);

    const res = await fakeServer.tools.mongo_find.execute({
      collection: "users",
      filter: '{"active":true}',
      limit: 10,
    });

    expect(JSON.parse(res)).toEqual([{ _id: "1", name: "item1" }]);
    expect(findMock).toHaveBeenCalledWith({ active: true }, { projection: undefined });
  });

  it("mongo_insert_one blocks write when readOnly is true", async () => {
    const fakeServer = new FakeServer();
    const mockConn = {
      id: "mongo1",
      type: "mongodb",
      readOnly: true,
      getClient: async () => ({ ok: true, client: {} }),
    };

    const fakeRegistry = {
      get: (id: string) => mockConn,
      findOneByType: () => mockConn,
      countByType: () => 1,
    };

    registerMongoDbTools(fakeServer as never, fakeRegistry as never);

    await expect(
      fakeServer.tools.mongo_insert_one.execute({ collection: "users", document: '{"name":"Alice"}' }),
    ).rejects.toThrow("READ_ONLY mode");
  });
});

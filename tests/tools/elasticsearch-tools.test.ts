import { describe, it, expect } from "vitest";
import { UserError } from "fastmcp";
import { registerElasticsearchTools } from "../../src/tools/elasticsearch-tools.js";

class FakeServer {
  public tools: Record<string, { execute: (args: never) => Promise<string> }> = {};
  addTool(def: { name: string; execute: (args: never) => Promise<string> }): void {
    this.tools[def.name] = def;
  }
}

function makeFakeRegistry(readOnly: boolean, getClientResult: unknown) {
  const conn = { id: "logs-es", type: "elasticsearch", readOnly, getClient: () => getClientResult };
  return {
    get: () => conn,
    findOneByType: () => conn,
    countByType: () => 1,
  };
}

describe("elasticsearch tools", () => {
  it("es_cluster_health returns cluster health", async () => {
    const client = { cluster: { health: async () => ({ status: "green" }) } };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.es_cluster_health.execute({} as never);
    expect(JSON.parse(result)).toEqual({ status: "green" });
  });

  it("es_cluster_health throws UserError with the connection status when unavailable", async () => {
    const status = { id: "logs-es", type: "elasticsearch", state: "circuit_open" as const, readOnly: true };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(true, { ok: false, status }) as never);

    await expect(server.tools.es_cluster_health.execute({} as never)).rejects.toThrow(UserError);
  });

  it("es_list_indices returns cat indices", async () => {
    const client = { cat: { indices: async () => [{ index: "logs-1" }] } };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.es_list_indices.execute({} as never);
    expect(JSON.parse(result)).toEqual([{ index: "logs-1" }]);
  });

  it("es_index_stats returns stats for an index", async () => {
    const client = { indices: { stats: async (args: { index: string }) => ({ indices: { [args.index]: {} } }) } };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.es_index_stats.execute({ index: "logs-1" } as never);
    expect(JSON.parse(result)).toEqual({ indices: { "logs-1": {} } });
  });

  it("es_search defaults to match_all and returns hits", async () => {
    let receivedQuery: unknown;
    const client = {
      search: async (args: { query: unknown }) => {
        receivedQuery = args.query;
        return { hits: { hits: [{ _id: "1" }], total: { value: 1 } } };
      },
    };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.es_search.execute({ index: "logs-1" } as never);
    expect(receivedQuery).toEqual({ match_all: {} });
    expect(JSON.parse(result)).toEqual({ hits: [{ _id: "1" }], total: { value: 1 } });
  });

  it("es_search passes through a given query", async () => {
    let receivedQuery: unknown;
    const client = {
      search: async (args: { query: unknown }) => {
        receivedQuery = args.query;
        return { hits: { hits: [] } };
      },
    };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    await server.tools.es_search.execute({ index: "logs-1", query: { match: { title: "foo" } } } as never);
    expect(receivedQuery).toEqual({ match: { title: "foo" } });
  });

  it("es_count returns document count", async () => {
    const client = { count: async () => ({ count: 42 }) };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.es_count.execute({ index: "logs-1" } as never);
    expect(JSON.parse(result)).toEqual({ count: 42 });
  });

  it("es_get_doc returns a document by id", async () => {
    const client = { get: async (args: { index: string; id: string }) => ({ _id: args.id, _source: { a: 1 } }) };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(true, { ok: true, client }) as never);

    const result = await server.tools.es_get_doc.execute({ index: "logs-1", id: "doc1" } as never);
    expect(JSON.parse(result)).toEqual({ _id: "doc1", _source: { a: 1 } });
  });

  it("es_index_doc refuses to run when the resolved connection's readOnly is true", async () => {
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);

    await expect(
      server.tools.es_index_doc.execute({ index: "logs-1", document: { a: 1 } } as never),
    ).rejects.toThrow(/READ_ONLY/);
  });

  it("es_index_doc indexes a document when the resolved connection's readOnly is false", async () => {
    const client = { index: async (args: unknown) => ({ result: "created", ...(args as object) }) };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(false, { ok: true, client }) as never);

    const result = await server.tools.es_index_doc.execute({ index: "logs-1", document: { a: 1 } } as never);
    expect(JSON.parse(result).result).toBe("created");
  });

  it("es_bulk_index refuses to run when the resolved connection's readOnly is true", async () => {
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);

    await expect(
      server.tools.es_bulk_index.execute({ index: "logs-1", documents: '[{"a":1}]' } as never),
    ).rejects.toThrow(/READ_ONLY/);
  });

  it("es_bulk_index is a no-op and does not call bulk when documents is an empty array", async () => {
    const bulkCalls: unknown[] = [];
    const client = { bulk: async (args: unknown) => bulkCalls.push(args) };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(false, { ok: true, client }) as never);

    const result = await server.tools.es_bulk_index.execute({ index: "logs-1", documents: "[]" } as never);

    expect(JSON.parse(result)).toEqual({ total: 0, succeeded: 0, failed: 0, results: [] });
    expect(bulkCalls).toHaveLength(0);
  });

  it("es_bulk_index builds alternating action/document operations, honoring an explicit _id", async () => {
    let receivedOperations: unknown[] = [];
    const client = {
      bulk: async (args: { operations: unknown[] }) => {
        receivedOperations = args.operations;
        return {
          errors: false,
          items: [{ index: { _id: "1", status: 201 } }, { index: { _id: "auto-2", status: 201 } }],
        };
      },
    };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(false, { ok: true, client }) as never);

    const result = await server.tools.es_bulk_index.execute({
      index: "logs-1",
      documents: JSON.stringify([{ _id: "1", title: "foo" }, { title: "bar" }]),
    } as never);

    expect(receivedOperations).toEqual([
      { index: { _index: "logs-1", _id: "1" } },
      { title: "foo" },
      { index: { _index: "logs-1" } },
      { title: "bar" },
    ]);
    expect(JSON.parse(result)).toEqual({
      total: 2,
      succeeded: 2,
      failed: 0,
      results: [{ id: "1", success: true }, { id: "auto-2", success: true }],
    });
  });

  it("es_bulk_index reports per-document failures without aborting the batch", async () => {
    const client = {
      bulk: async () => ({
        errors: true,
        items: [
          { index: { _id: "1", status: 201 } },
          { index: { _id: "2", status: 409, error: { type: "version_conflict_engine_exception" } } },
        ],
      }),
    };
    const server = new FakeServer();
    registerElasticsearchTools(server as never, makeFakeRegistry(false, { ok: true, client }) as never);

    const result = await server.tools.es_bulk_index.execute({
      index: "logs-1",
      documents: JSON.stringify([{ _id: "1", a: 1 }, { _id: "2", a: 2 }]),
    } as never);

    const parsed = JSON.parse(result);
    expect(parsed.total).toBe(2);
    expect(parsed.succeeded).toBe(1);
    expect(parsed.failed).toBe(1);
    expect(parsed.results[1].success).toBe(false);
    expect(parsed.results[1].error).toContain("version_conflict_engine_exception");
  });

  it("es_update_doc updates a document and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerElasticsearchTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(
      serverReadOnly.tools.es_update_doc.execute({ index: "logs-1", id: "doc1", doc: { a: 1 } } as never),
    ).rejects.toThrow(/READ_ONLY/);

    const client = { update: async () => ({ result: "updated" }) };
    const serverWritable = new FakeServer();
    registerElasticsearchTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.es_update_doc.execute({
      index: "logs-1",
      id: "doc1",
      doc: { a: 1 },
    } as never);
    expect(JSON.parse(result).result).toBe("updated");
  });

  it("es_delete_doc deletes a document and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerElasticsearchTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(
      serverReadOnly.tools.es_delete_doc.execute({ index: "logs-1", id: "doc1" } as never),
    ).rejects.toThrow(/READ_ONLY/);

    const client = { delete: async () => ({ result: "deleted" }) };
    const serverWritable = new FakeServer();
    registerElasticsearchTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.es_delete_doc.execute({ index: "logs-1", id: "doc1" } as never);
    expect(JSON.parse(result).result).toBe("deleted");
  });

  it("es_delete_by_query deletes matching documents and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerElasticsearchTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(
      serverReadOnly.tools.es_delete_by_query.execute({ index: "logs-1", query: { match_all: {} } } as never),
    ).rejects.toThrow(/READ_ONLY/);

    const client = { deleteByQuery: async () => ({ deleted: 3 }) };
    const serverWritable = new FakeServer();
    registerElasticsearchTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client }) as never);
    const result = await serverWritable.tools.es_delete_by_query.execute({
      index: "logs-1",
      query: { match_all: {} },
    } as never);
    expect(JSON.parse(result).deleted).toBe(3);
  });
});

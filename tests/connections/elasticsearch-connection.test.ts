import { describe, it, expect, vi, beforeEach } from "vitest";

const pingMockV9 = vi.fn();
const closeMockV9 = vi.fn();
const rawMethodsV9 = {
  cluster: { health: vi.fn() },
  cat: { indices: vi.fn() },
  indices: { stats: vi.fn() },
  search: vi.fn(),
  count: vi.fn(),
  get: vi.fn(),
  index: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  deleteByQuery: vi.fn(),
};

vi.mock("@elastic/elasticsearch", () => {
  const ClientMock = vi.fn().mockImplementation(function () {
    return {
      ping: pingMockV9,
      close: closeMockV9,
      ...rawMethodsV9,
    };
  });
  return { Client: ClientMock };
});

const pingMockV7 = vi.fn();
const closeMockV7 = vi.fn();
const rawMethodsV7 = {
  cluster: { health: vi.fn() },
  cat: { indices: vi.fn() },
  indices: { stats: vi.fn() },
  search: vi.fn(),
  count: vi.fn(),
  get: vi.fn(),
  index: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  deleteByQuery: vi.fn(),
};

vi.mock("es7-client", () => {
  const ClientMock = vi.fn().mockImplementation(function () {
    return {
      ping: pingMockV7,
      close: closeMockV7,
      ...rawMethodsV7,
    };
  });
  return { Client: ClientMock };
});

const { ElasticsearchConnection } = await import("../../src/connections/elasticsearch-connection.js");

const fastSleep = (_ms: number) => new Promise<void>((resolve) => setTimeout(resolve, 1));

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("ElasticsearchConnection", () => {
  beforeEach(() => {
    pingMockV9.mockReset();
    closeMockV9.mockReset();
    pingMockV7.mockReset();
    closeMockV7.mockReset();
    for (const fn of Object.values(rawMethodsV9)) {
      if ("mockReset" in fn) fn.mockReset();
      else Object.values(fn).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset());
    }
    for (const fn of Object.values(rawMethodsV7)) {
      if ("mockReset" in fn) fn.mockReset();
      else Object.values(fn).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset());
    }
  });

  it("defaults to the v9 client when apiVersion is omitted", async () => {
    pingMockV9.mockResolvedValue(true);
    const conn = new ElasticsearchConnection({ id: "es1", connectionString: "http://localhost:9200", sleep: fastSleep });
    expect(conn.apiVersion).toBe("9");

    conn.start();
    await waitUntil(() => conn.state === "connected");
    expect((await conn.getClient()).ok).toBe(true);
    expect(pingMockV9).toHaveBeenCalledOnce();
    conn.stop();
  });

  it("reports failed state without throwing when the v9 client's ping rejects", async () => {
    pingMockV9.mockRejectedValue(new Error("ECONNREFUSED"));
    const conn = new ElasticsearchConnection({
      id: "es2",
      connectionString: "http://localhost:9200",
      baseBackoffMs: 1,
      maxBackoffMs: 1,
      sleep: fastSleep,
    });

    conn.start();
    await waitUntil(() => conn.state === "failed" || conn.state === "retrying");
    const result = await conn.getClient();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status.lastError?.message).toBe("ECONNREFUSED");
    conn.stop();
  });

  it("closes the v9 client via close() when stopped", async () => {
    pingMockV9.mockResolvedValue(true);
    closeMockV9.mockResolvedValue(undefined);
    const conn = new ElasticsearchConnection({ id: "es3", connectionString: "http://localhost:9200", sleep: fastSleep });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    await conn.stop();
    expect(closeMockV9).toHaveBeenCalledOnce();
  });

  it("carries its own readOnly mode independent of other connections", () => {
    const readOnlyConn = new ElasticsearchConnection({ id: "es4", connectionString: "http://localhost:9200" });
    expect(readOnlyConn.readOnly).toBe(true);

    const writableConn = new ElasticsearchConnection({
      id: "es5",
      connectionString: "http://localhost:9200",
      readOnly: false,
    });
    expect(writableConn.readOnly).toBe(false);
  });

  it("passes v9 params straight through and returns the response unwrapped", async () => {
    pingMockV9.mockResolvedValue(true);
    rawMethodsV9.search.mockResolvedValue({ hits: { hits: [{ _id: "1" }] } });
    const conn = new ElasticsearchConnection({ id: "es6", connectionString: "http://localhost:9200", sleep: fastSleep });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    const result = await conn.getClient();
    if (!result.ok) throw new Error("expected connected");
    const response = await result.client.search({ index: "logs", query: { match_all: {} }, size: 5 });

    expect(rawMethodsV9.search).toHaveBeenCalledWith({ index: "logs", query: { match_all: {} }, size: 5 });
    expect(response).toEqual({ hits: { hits: [{ _id: "1" }] } });
    conn.stop();
  });

  it("maps sort/searchAfter/seqNoPrimaryTerm to snake_case for the v9 client", async () => {
    pingMockV9.mockResolvedValue(true);
    rawMethodsV9.search.mockResolvedValue({ hits: { hits: [] } });
    const conn = new ElasticsearchConnection({ id: "es6b", connectionString: "http://localhost:9200", sleep: fastSleep });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    const result = await conn.getClient();
    if (!result.ok) throw new Error("expected connected");
    await result.client.search({
      index: "logs",
      query: { match_all: {} },
      sort: [{ _seq_no: "asc" }],
      searchAfter: [42],
      seqNoPrimaryTerm: true,
    });

    expect(rawMethodsV9.search).toHaveBeenCalledWith({
      index: "logs",
      query: { match_all: {} },
      sort: [{ _seq_no: "asc" }],
      search_after: [42],
      seq_no_primary_term: true,
    });
    conn.stop();
  });

  it("connects using the v7 client when apiVersion is '7'", async () => {
    pingMockV7.mockResolvedValue({ body: true });
    const conn = new ElasticsearchConnection({
      id: "es7",
      connectionString: "http://localhost:9200",
      apiVersion: "7",
      sleep: fastSleep,
    });
    expect(conn.apiVersion).toBe("7");

    conn.start();
    await waitUntil(() => conn.state === "connected");
    expect((await conn.getClient()).ok).toBe(true);
    expect(pingMockV7).toHaveBeenCalledOnce();
    expect(pingMockV9).not.toHaveBeenCalled();
    conn.stop();
  });

  it("nests v7 search/count params under body and unwraps the .body response", async () => {
    pingMockV7.mockResolvedValue({ body: true });
    rawMethodsV7.search.mockResolvedValue({ body: { hits: { hits: [{ _id: "1" }] } }, statusCode: 200 });
    rawMethodsV7.count.mockResolvedValue({ body: { count: 3 }, statusCode: 200 });
    const conn = new ElasticsearchConnection({
      id: "es8",
      connectionString: "http://localhost:9200",
      apiVersion: "7",
      sleep: fastSleep,
    });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    const result = await conn.getClient();
    if (!result.ok) throw new Error("expected connected");

    const searchResponse = await result.client.search({ index: "logs", query: { match_all: {} }, size: 5 });
    expect(rawMethodsV7.search).toHaveBeenCalledWith({ index: "logs", body: { query: { match_all: {} }, size: 5 } });
    expect(searchResponse).toEqual({ hits: { hits: [{ _id: "1" }] } });

    const countResponse = await result.client.count({ index: "logs", query: { match_all: {} } });
    expect(rawMethodsV7.count).toHaveBeenCalledWith({ index: "logs", body: { query: { match_all: {} } } });
    expect(countResponse).toEqual({ count: 3 });

    conn.stop();
  });

  it("nests v7 sort/search_after/seq_no_primary_term under body, unmapped from camelCase", async () => {
    pingMockV7.mockResolvedValue({ body: true });
    rawMethodsV7.search.mockResolvedValue({ body: { hits: { hits: [] } }, statusCode: 200 });
    const conn = new ElasticsearchConnection({
      id: "es8b",
      connectionString: "http://localhost:9200",
      apiVersion: "7",
      sleep: fastSleep,
    });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    const result = await conn.getClient();
    if (!result.ok) throw new Error("expected connected");

    await result.client.search({
      index: "logs",
      query: { match_all: {} },
      sort: [{ _seq_no: "asc" }],
      searchAfter: [42],
      seqNoPrimaryTerm: true,
    });

    expect(rawMethodsV7.search).toHaveBeenCalledWith({
      index: "logs",
      body: {
        query: { match_all: {} },
        sort: [{ _seq_no: "asc" }],
        search_after: [42],
        seq_no_primary_term: true,
      },
    });

    conn.stop();
  });

  it("nests v7 index/update/deleteByQuery params under body and unwraps the .body response", async () => {
    pingMockV7.mockResolvedValue({ body: true });
    rawMethodsV7.index.mockResolvedValue({ body: { result: "created" }, statusCode: 201 });
    rawMethodsV7.update.mockResolvedValue({ body: { result: "updated" }, statusCode: 200 });
    rawMethodsV7.deleteByQuery.mockResolvedValue({ body: { deleted: 2 }, statusCode: 200 });
    const conn = new ElasticsearchConnection({
      id: "es9",
      connectionString: "http://localhost:9200",
      apiVersion: "7",
      sleep: fastSleep,
    });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    const result = await conn.getClient();
    if (!result.ok) throw new Error("expected connected");

    const indexResponse = await result.client.index({ index: "logs", id: "doc1", document: { a: 1 } });
    expect(rawMethodsV7.index).toHaveBeenCalledWith({ index: "logs", id: "doc1", body: { a: 1 } });
    expect(indexResponse).toEqual({ result: "created" });

    const updateResponse = await result.client.update({ index: "logs", id: "doc1", doc: { a: 2 } });
    expect(rawMethodsV7.update).toHaveBeenCalledWith({ index: "logs", id: "doc1", body: { doc: { a: 2 } } });
    expect(updateResponse).toEqual({ result: "updated" });

    const deleteByQueryResponse = await result.client.deleteByQuery({ index: "logs", query: { match_all: {} } });
    expect(rawMethodsV7.deleteByQuery).toHaveBeenCalledWith({ index: "logs", body: { query: { match_all: {} } } });
    expect(deleteByQueryResponse).toEqual({ deleted: 2 });

    conn.stop();
  });

  it("closes the v7 client via close() when stopped", async () => {
    pingMockV7.mockResolvedValue({ body: true });
    closeMockV7.mockResolvedValue(undefined);
    const conn = new ElasticsearchConnection({
      id: "es10",
      connectionString: "http://localhost:9200",
      apiVersion: "7",
      sleep: fastSleep,
    });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    await conn.stop();
    expect(closeMockV7).toHaveBeenCalledOnce();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const pingMock = vi.fn();
const closeMock = vi.fn();

vi.mock("@elastic/elasticsearch", () => {
  const ClientMock = vi.fn().mockImplementation(() => ({
    ping: pingMock,
    close: closeMock,
  }));
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
    pingMock.mockReset();
    closeMock.mockReset();
  });

  it("connects successfully when ping resolves", async () => {
    pingMock.mockResolvedValue(true);
    const conn = new ElasticsearchConnection({ id: "es1", connectionString: "http://localhost:9200", sleep: fastSleep });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    expect((await conn.getClient()).ok).toBe(true);
    conn.stop();
  });

  it("reports failed state without throwing when ping rejects", async () => {
    pingMock.mockRejectedValue(new Error("ECONNREFUSED"));
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

  it("closes the client via close() when stopped", async () => {
    pingMock.mockResolvedValue(true);
    closeMock.mockResolvedValue(undefined);
    const conn = new ElasticsearchConnection({ id: "es3", connectionString: "http://localhost:9200", sleep: fastSleep });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    await conn.stop();
    expect(closeMock).toHaveBeenCalledOnce();
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
});

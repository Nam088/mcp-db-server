import { describe, it, expect, vi, beforeEach } from "vitest";

const pingMock = vi.fn();
const connectMock = vi.fn();
const closeMock = vi.fn();

vi.mock("mongodb", () => {
  return {
    MongoClient: vi.fn().mockImplementation(() => ({
      connect: connectMock,
      close: closeMock,
      db: () => ({
        admin: () => ({
          ping: pingMock,
        }),
      }),
    })),
  };
});

const { MongoDbConnection } = await import("../../src/connections/mongodb-connection.js");

const fastSleep = (_ms: number) => new Promise<void>((resolve) => setTimeout(resolve, 1));

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("MongoDbConnection", () => {
  beforeEach(() => {
    pingMock.mockReset();
    connectMock.mockReset();
    closeMock.mockReset();
  });

  it("connects successfully when connect and ping resolve", async () => {
    connectMock.mockResolvedValue(undefined);
    pingMock.mockResolvedValue({ ok: 1 });

    const conn = new MongoDbConnection({
      id: "mg1",
      connectionString: "mongodb://localhost:27017",
      defaultDatabase: "test",
      sleep: fastSleep,
    });
    conn.start();

    await waitUntil(() => conn.state === "connected");
    expect((await conn.getClient()).ok).toBe(true);
    await conn.stop();
  });

  it("reports failed state when ping fails", async () => {
    connectMock.mockResolvedValue(undefined);
    pingMock.mockRejectedValue(new Error("auth failed"));

    const conn = new MongoDbConnection({
      id: "mg2",
      connectionString: "mongodb://localhost:27017",
      baseBackoffMs: 1,
      maxBackoffMs: 1,
      sleep: fastSleep,
    });
    conn.start();

    await waitUntil(() => conn.state === "failed" || conn.state === "retrying");
    const result = await conn.getClient();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status.lastError?.message).toBe("auth failed");
    await conn.stop();
  });

  it("stores defaultDatabase and readOnly options", () => {
    const conn = new MongoDbConnection({
      id: "mg3",
      connectionString: "mongodb://localhost:27017",
      defaultDatabase: "mydb",
      readOnly: true,
    });
    expect(conn.defaultDatabase).toBe("mydb");
    expect(conn.readOnly).toBe(true);
  });
});

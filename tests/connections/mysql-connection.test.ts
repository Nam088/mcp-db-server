import { describe, it, expect, vi, beforeEach } from "vitest";

const pingMock = vi.fn();
const queryMock = vi.fn();
const releaseMock = vi.fn();
const getConnectionMock = vi.fn().mockImplementation(() => ({
  ping: pingMock,
  query: queryMock,
  release: releaseMock,
}));

vi.mock("mysql2/promise", () => {
  return {
    default: {
      createPool: vi.fn().mockImplementation(() => ({
        getConnection: getConnectionMock,
        end: vi.fn().mockResolvedValue(undefined),
      })),
    },
  };
});

const { MySqlConnection } = await import("../../src/connections/mysql-connection.js");

const fastSleep = (_ms: number) => new Promise<void>((resolve) => setTimeout(resolve, 1));

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("MySqlConnection", () => {
  beforeEach(() => {
    pingMock.mockReset();
    queryMock.mockReset();
    releaseMock.mockReset();
    getConnectionMock.mockClear();
  });

  it("connects successfully when ping resolves", async () => {
    pingMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValue([]);

    const conn = new MySqlConnection({ id: "my1", connectionString: "mysql://localhost:3306/db", sleep: fastSleep });
    conn.start();

    await waitUntil(() => conn.state === "connected");
    expect((await conn.getClient()).ok).toBe(true);
    await conn.stop();
  });

  it("reports failed state when ping fails", async () => {
    pingMock.mockRejectedValue(new Error("access denied"));

    const conn = new MySqlConnection({
      id: "my2",
      connectionString: "mysql://localhost:3306/db",
      baseBackoffMs: 1,
      maxBackoffMs: 1,
      sleep: fastSleep,
    });
    conn.start();

    await waitUntil(() => conn.state === "failed" || conn.state === "retrying");
    const result = await conn.getClient();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status.lastError?.message).toBe("access denied");
    await conn.stop();
  });

  it("carries its readOnly status", () => {
    const connReadOnly = new MySqlConnection({ id: "my3", connectionString: "mysql://x", readOnly: true });
    expect(connReadOnly.readOnly).toBe(true);

    const connWritable = new MySqlConnection({ id: "my4", connectionString: "mysql://x", readOnly: false });
    expect(connWritable.readOnly).toBe(false);
  });
});

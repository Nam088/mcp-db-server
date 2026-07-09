import { describe, it, expect, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
let lastErrorHandler: ((err: Error) => void) | undefined;

vi.mock("pg", () => {
  return {
    Pool: vi.fn().mockImplementation(() => ({
      query: queryMock,
      on: (event: string, handler: (err: Error) => void) => {
        if (event === "error") lastErrorHandler = handler;
      },
    })),
  };
});

const { PostgresConnection } = await import("../../src/connections/postgres-connection.js");

const fastSleep = (_ms: number) => new Promise<void>((resolve) => setTimeout(resolve, 1));

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("PostgresConnection", () => {
  beforeEach(() => {
    queryMock.mockReset();
    lastErrorHandler = undefined;
  });

  it("connects successfully when the ping query resolves", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const conn = new PostgresConnection({ id: "pg1", connectionString: "postgres://x", sleep: fastSleep });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    expect(conn.getClient().ok).toBe(true);
    conn.stop();
  });

  it("reports failed state without throwing when the ping query rejects", async () => {
    queryMock.mockRejectedValue(new Error("connection refused"));
    const conn = new PostgresConnection({
      id: "pg2",
      connectionString: "postgres://x",
      baseBackoffMs: 1,
      maxBackoffMs: 1,
      sleep: fastSleep,
    });

    conn.start();
    await waitUntil(() => conn.state === "failed" || conn.state === "retrying");
    const result = conn.getClient();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status.lastError?.message).toBe("connection refused");
    conn.stop();
  });

  it("transitions to failed when the pool emits a fatal error after connecting", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const conn = new PostgresConnection({ id: "pg3", connectionString: "postgres://x", sleep: fastSleep });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    expect(lastErrorHandler).toBeDefined();

    lastErrorHandler?.(new Error("idle client crash"));
    expect(conn.state).toBe("failed");
    conn.stop();
  });

  it("carries its own readOnly mode independent of other connections", () => {
    const readOnlyConn = new PostgresConnection({ id: "pg4", connectionString: "postgres://x" });
    expect(readOnlyConn.readOnly).toBe(true);

    const writableConn = new PostgresConnection({ id: "pg5", connectionString: "postgres://x", readOnly: false });
    expect(writableConn.readOnly).toBe(false);
  });
});

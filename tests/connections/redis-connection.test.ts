import { describe, it, expect, vi, beforeEach } from "vitest";

const connectMock = vi.fn();
const pingMock = vi.fn();
let lastErrorHandler: ((err: Error) => void) | undefined;

vi.mock("ioredis", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      connect: connectMock,
      ping: pingMock,
      on: (event: string, handler: (err: Error) => void) => {
        if (event === "error") lastErrorHandler = handler;
      },
    })),
  };
});

const { RedisConnection } = await import("../../src/connections/redis-connection.js");

const fastSleep = (_ms: number) => new Promise<void>((resolve) => setTimeout(resolve, 1));

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("RedisConnection", () => {
  beforeEach(() => {
    connectMock.mockReset();
    pingMock.mockReset();
    lastErrorHandler = undefined;
  });

  it("connects successfully when connect and ping resolve", async () => {
    connectMock.mockResolvedValue(undefined);
    pingMock.mockResolvedValue("PONG");
    const conn = new RedisConnection({ id: "redis1", connectionString: "redis://x", sleep: fastSleep });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    expect(conn.getClient().ok).toBe(true);
    conn.stop();
  });

  it("reports failed state without throwing when connect rejects", async () => {
    connectMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const conn = new RedisConnection({
      id: "redis2",
      connectionString: "redis://x",
      baseBackoffMs: 1,
      maxBackoffMs: 1,
      sleep: fastSleep,
    });

    conn.start();
    await waitUntil(() => conn.state === "failed" || conn.state === "retrying");
    const result = conn.getClient();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status.lastError?.message).toBe("ECONNREFUSED");
    conn.stop();
  });

  it("transitions to failed when the client emits a fatal error after connecting", async () => {
    connectMock.mockResolvedValue(undefined);
    pingMock.mockResolvedValue("PONG");
    const conn = new RedisConnection({ id: "redis3", connectionString: "redis://x", sleep: fastSleep });

    conn.start();
    await waitUntil(() => conn.state === "connected");
    expect(lastErrorHandler).toBeDefined();

    lastErrorHandler?.(new Error("socket closed"));
    expect(conn.state).toBe("failed");
    conn.stop();
  });

  it("carries its own readOnly mode independent of other connections", () => {
    const readOnlyConn = new RedisConnection({ id: "redis4", connectionString: "redis://x" });
    expect(readOnlyConn.readOnly).toBe(true);

    const writableConn = new RedisConnection({ id: "redis5", connectionString: "redis://x", readOnly: false });
    expect(writableConn.readOnly).toBe(false);
  });
});

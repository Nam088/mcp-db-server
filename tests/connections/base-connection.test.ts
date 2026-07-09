import { describe, it, expect } from "vitest";
import { BaseConnection, type BaseConnectionOptions } from "../../src/connections/base-connection.js";

const fastSleep = (_ms: number) => new Promise<void>((resolve) => setTimeout(resolve, 1));

class TestConnection extends BaseConnection<string> {
  public attempts = 0;
  private behavior: (attempt: number) => Promise<string>;

  constructor(behavior: (attempt: number) => Promise<string>, options: Partial<BaseConnectionOptions> = {}) {
    super({ id: "test", type: "test", baseBackoffMs: 1, maxBackoffMs: 1, sleep: fastSleep, ...options });
    this.behavior = behavior;
  }

  protected async attemptConnect(): Promise<string> {
    this.attempts++;
    return this.behavior(this.attempts);
  }

  protected async closeClient(_client: string): Promise<void> {
    // no-op
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("BaseConnection", () => {
  it("starts idle and becomes connected after a successful attempt", async () => {
    const conn = new TestConnection(async () => "client-ok");
    expect(conn.state).toBe("idle");

    conn.start();
    await waitUntil(() => conn.state === "connected");

    const result = await conn.getClient();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.client).toBe("client-ok");
    conn.stop();
  });

  it("reports an unavailable status while retrying, then connects once attempts succeed", async () => {
    const conn = new TestConnection(async (attempt) => {
      if (attempt < 3) throw new Error("boom");
      return "client-ok";
    });

    conn.start();
    await waitUntil(() => conn.attempts >= 1);

    const early = conn.getStatus();
    expect(["connecting", "retrying", "failed"]).toContain(early.state);

    await waitUntil(() => conn.state === "connected");
    expect((await conn.getClient()).ok).toBe(true);
    conn.stop();
  });

  it("opens the circuit after consecutive failures and stops calling attemptConnect", async () => {
    const conn = new TestConnection(
      async () => {
        throw new Error("always fails");
      },
      { maxConsecutiveFailures: 2, circuitResetMs: 60_000, maxRetries: 100 },
    );

    conn.start();
    await waitUntil(() => conn.state === "circuit_open");

    const attemptsAtOpen = conn.attempts;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(conn.attempts).toBe(attemptsAtOpen);

    const result = await conn.getClient();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status.state).toBe("circuit_open");
    conn.stop();
  });

  it("getClient() returns immediately instead of waiting for the connection to establish", async () => {
    const conn = new TestConnection(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "client-ok";
    });

    const startedAt = Date.now();
    const result = await conn.getClient();
    expect(Date.now() - startedAt).toBeLessThan(50);
    expect(result.ok).toBe(false);

    await waitUntil(() => conn.state === "connected");
    conn.stop();
  });

  it("getClient() re-triggers the connection loop once it has given up after maxRetries", async () => {
    let shouldSucceed = false;
    const conn = new TestConnection(
      async () => {
        if (!shouldSucceed) throw new Error("boom");
        return "client-ok";
      },
      { maxRetries: 1 },
    );

    conn.start();
    await waitUntil(() => conn.state === "failed");
    const attemptsAfterGivingUp = conn.attempts;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(conn.attempts).toBe(attemptsAfterGivingUp); // confirms the loop gave up, not just backing off

    shouldSucceed = true;
    await conn.getClient();
    await waitUntil(() => conn.state === "connected");
    conn.stop();
  });

  it("defaults readOnly to true and exposes an explicit override", () => {
    const readOnlyByDefault = new TestConnection(async () => "x");
    expect(readOnlyByDefault.readOnly).toBe(true);

    const writable = new TestConnection(async () => "x", { readOnly: false });
    expect(writable.readOnly).toBe(false);
  });

  it("extracts a useful message from an AggregateError (e.g. dual-stack ECONNREFUSED) instead of an empty string", async () => {
    const conn = new TestConnection(async () => {
      throw new AggregateError([new Error("connect ECONNREFUSED 127.0.0.1:59999"), new Error("connect ECONNREFUSED ::1:59999")]);
    });

    conn.start();
    await waitUntil(() => conn.state === "failed");
    const result = await conn.getClient();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status.lastError?.message).toContain("ECONNREFUSED");
    }
    conn.stop();
  });
});

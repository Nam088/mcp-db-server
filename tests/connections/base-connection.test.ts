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

    const result = conn.getClient();
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

    const early = conn.getClient();
    expect(early.ok).toBe(false);
    if (!early.ok) {
      expect(["connecting", "retrying", "failed"]).toContain(early.status.state);
    }

    await waitUntil(() => conn.state === "connected");
    expect(conn.getClient().ok).toBe(true);
    conn.stop();
  });

  it("opens the circuit after consecutive failures and stops calling attemptConnect", async () => {
    const conn = new TestConnection(
      async () => {
        throw new Error("always fails");
      },
      { maxConsecutiveFailures: 2, circuitResetMs: 60_000 },
    );

    conn.start();
    await waitUntil(() => conn.state === "circuit_open");

    const attemptsAtOpen = conn.attempts;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(conn.attempts).toBe(attemptsAtOpen);

    const result = conn.getClient();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status.state).toBe("circuit_open");
    conn.stop();
  });

  it("defaults readOnly to true and exposes an explicit override", () => {
    const readOnlyByDefault = new TestConnection(async () => "x");
    expect(readOnlyByDefault.readOnly).toBe(true);

    const writable = new TestConnection(async () => "x", { readOnly: false });
    expect(writable.readOnly).toBe(false);
  });
});

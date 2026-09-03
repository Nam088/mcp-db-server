import { describe, it, expect } from "vitest";
import { registerStatusTools } from "../../src/tools/status-tools.js";
import type { ConnectionStatus } from "../../src/connections/types.js";

class FakeServer {
  public tools: Record<string, { execute: (args: unknown) => Promise<string> }> = {};
  addTool(def: { name: string; execute: (args: unknown) => Promise<string> }): void {
    this.tools[def.name] = def;
  }
}

describe("db_status tool", () => {
  it("returns the registry's statuses as JSON", async () => {
    const fakeServer = new FakeServer();
    const statuses: ConnectionStatus[] = [
      { id: "primary-pg", type: "postgres", state: "connected", readOnly: true },
      {
        id: "cache",
        type: "redis",
        state: "failed",
        readOnly: false,
        lastError: { message: "ECONNREFUSED", at: "2026-07-09T00:00:00.000Z" },
      },
    ];
    const fakeRegistry = { listStatuses: () => statuses };

    registerStatusTools(fakeServer as never, fakeRegistry as never);

    const result = await fakeServer.tools.db_status.execute({});
    expect(JSON.parse(result)).toEqual(statuses);
  });

  it("returns a single connection's status when connectionId is provided", async () => {
    const fakeServer = new FakeServer();
    const pgStatus: ConnectionStatus = { id: "primary-pg", type: "postgres", state: "connected", readOnly: true };
    const fakeConn = { getStatus: () => pgStatus };
    const fakeRegistry = {
      get: (id: string) => (id === "primary-pg" ? fakeConn : undefined),
      listStatuses: () => [pgStatus],
    };

    registerStatusTools(fakeServer as never, fakeRegistry as never);

    const result = await fakeServer.tools.db_status.execute({ connectionId: "primary-pg" });
    expect(JSON.parse(result)).toEqual(pgStatus);
  });

  it("supports 'id' alias for connectionId", async () => {
    const fakeServer = new FakeServer();
    const pgStatus: ConnectionStatus = { id: "primary-pg", type: "postgres", state: "connected", readOnly: true };
    const fakeConn = { getStatus: () => pgStatus };
    const fakeRegistry = {
      get: (id: string) => (id === "primary-pg" ? fakeConn : undefined),
      listStatuses: () => [pgStatus],
    };

    registerStatusTools(fakeServer as never, fakeRegistry as never);

    const result = await fakeServer.tools.db_status.execute({ id: "primary-pg" });
    expect(JSON.parse(result)).toEqual(pgStatus);
  });

  it("throws UserError when connectionId is not found", async () => {
    const fakeServer = new FakeServer();
    const fakeRegistry = {
      get: () => undefined,
      listStatuses: () => [{ id: "primary-pg", type: "postgres", state: "connected", readOnly: true }],
    };

    registerStatusTools(fakeServer as never, fakeRegistry as never);

    await expect(fakeServer.tools.db_status.execute({ connectionId: "unknown-db" })).rejects.toThrow(
      /Connection "unknown-db" not found/,
    );
  });

  it("filters connections by type", async () => {
    const fakeServer = new FakeServer();
    const pgStatus: ConnectionStatus = { id: "primary-pg", type: "postgres", state: "connected", readOnly: true };
    const fakeRegistry = {
      listStatuses: (filter?: { type?: string }) => (filter?.type === "postgres" ? [pgStatus] : []),
    };

    registerStatusTools(fakeServer as never, fakeRegistry as never);

    const result = await fakeServer.tools.db_status.execute({ type: "postgres" });
    expect(JSON.parse(result)).toEqual([pgStatus]);
  });

  it("actively probes a single connection when probe is true", async () => {
    const fakeServer = new FakeServer();
    const probedStatus: ConnectionStatus = {
      id: "primary-pg",
      type: "postgres",
      state: "connected",
      readOnly: true,
      latencyMs: 12,
    };
    let probeCalledWithTimeout: number | undefined;
    const fakeConn = {
      probe: async (timeoutMs: number) => {
        probeCalledWithTimeout = timeoutMs;
        return probedStatus;
      },
      getStatus: () => ({ id: "primary-pg", type: "postgres", state: "idle", readOnly: true }),
    };
    const fakeRegistry = {
      get: () => fakeConn,
      listStatuses: () => [],
    };

    registerStatusTools(fakeServer as never, fakeRegistry as never);

    const result = await fakeServer.tools.db_status.execute({ connectionId: "primary-pg", probe: true, timeoutMs: 3000 });
    expect(probeCalledWithTimeout).toBe(3000);
    expect(JSON.parse(result)).toEqual(probedStatus);
  });

  it("probes all connections when probe is true without connectionId", async () => {
    const fakeServer = new FakeServer();
    const probedStatuses: ConnectionStatus[] = [
      { id: "primary-pg", type: "postgres", state: "connected", readOnly: true, latencyMs: 5 },
    ];
    let probeAllCalled = false;
    const fakeRegistry = {
      probeAll: async () => {
        probeAllCalled = true;
        return probedStatuses;
      },
      listStatuses: () => [],
    };

    registerStatusTools(fakeServer as never, fakeRegistry as never);

    const result = await fakeServer.tools.db_status.execute({ probe: true });
    expect(probeAllCalled).toBe(true);
    expect(JSON.parse(result)).toEqual(probedStatuses);
  });

  it("db_reload_config calls reload on the registry and returns new statuses", async () => {
    const fakeServer = new FakeServer();
    let reloadCalled = false;
    const statuses: ConnectionStatus[] = [
      { id: "primary-pg", type: "postgres", state: "connected", readOnly: true },
    ];
    const fakeRegistry = {
      reload: async () => {
        reloadCalled = true;
      },
      listStatuses: () => statuses,
    };

    registerStatusTools(fakeServer as never, fakeRegistry as never);

    const result = await fakeServer.tools.db_reload_config.execute({});
    expect(reloadCalled).toBe(true);
    expect(JSON.parse(result)).toEqual({
      success: true,
      message: "Configuration reloaded and connections recreated.",
      connections: statuses,
    });
  });
});

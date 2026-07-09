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

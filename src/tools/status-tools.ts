import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { ConnectionRegistry } from "../connections/registry.js";

export function registerStatusTools(server: FastMCP, registry: ConnectionRegistry): void {
  server.addTool({
    name: "db_status",
    description:
      "List the live connection state of every configured database (postgres/redis), including state, readOnly mode, last error, and next retry time.",
    parameters: z.object({}),
    execute: async () => {
      return JSON.stringify(registry.listStatuses());
    },
  });
}

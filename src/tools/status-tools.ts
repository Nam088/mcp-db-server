import { z } from "zod";
import { UserError, type FastMCP } from "fastmcp";
import type { ConnectionRegistry } from "../connections/registry.js";

const VALID_TYPES = ["postgres", "redis", "elasticsearch", "mysql", "mongodb", "ldap"] as const;

export function registerStatusTools(server: FastMCP, registry: ConnectionRegistry): void {
  server.addTool({
    name: "db_status",
    description:
      "Inspect the live connection state of configured databases. Supports inspecting an individual database by connectionId, filtering by engine type, and active live probing with latency measurement.",
    parameters: z.object({
      connectionId: z
        .string()
        .optional()
        .describe("Inspect only the database with this ID (e.g., 'primary-pg', 'drkumo-d6')."),
      id: z
        .string()
        .optional()
        .describe("Alias for connectionId."),
      type: z
        .enum(VALID_TYPES)
        .optional()
        .describe("Filter databases by engine type."),
      probe: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, actively tests/pings the connection live and measures latency (in ms) instead of returning cached status.",
        ),
      timeoutMs: z
        .number()
        .optional()
        .default(5000)
        .describe("Timeout in milliseconds for the live probe (default: 5000ms)."),
    }),
    execute: async (args) => {
      const targetId = args.connectionId ?? args.id;
      const { type, probe = false, timeoutMs = 5000 } = args;

      if (targetId) {
        const conn = registry.get(targetId);
        if (!conn) {
          const available = registry.listStatuses().map((s) => s.id);
          throw new UserError(
            `Connection "${targetId}" not found. Available connections: ${available.join(", ") || "(none)"}`,
          );
        }

        if (probe) {
          const status = await conn.probe(timeoutMs);
          return JSON.stringify(status);
        }
        return JSON.stringify(conn.getStatus());
      }

      if (probe) {
        const statuses = await registry.probeAll({ type }, timeoutMs);
        return JSON.stringify(statuses);
      }

      return JSON.stringify(registry.listStatuses({ type }));
    },
  });

  server.addTool({
    name: "db_reload_config",
    description:
      "Reload the databases.config.yml configuration file from disk, recreate connections, and reconnect.",
    parameters: z.object({}),
    execute: async () => {
      await registry.reload();
      return JSON.stringify({ success: true, message: "Configuration reloaded and connections recreated.", connections: registry.listStatuses() });
    },
  });
}

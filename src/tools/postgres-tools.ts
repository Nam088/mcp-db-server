import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { ConnectionRegistry } from "../connections/registry.js";
import { resolveConnection, requireWritable, throwUnavailable } from "./connection-helpers.js";

const connectionIdParam = z
  .string()
  .optional()
  .describe(
    "Id of the postgres connection to use, from databases.config.yml. Optional when only one postgres connection is configured.",
  );

export function registerPostgresTools(server: FastMCP, registry: ConnectionRegistry): void {
  server.addTool({
    name: "pg_query",
    description: "Run a read-only SELECT query against a configured Postgres connection.",
    parameters: z.object({
      sql: z.string().describe("A SELECT statement."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ sql, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(sql);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_execute_sql",
    description:
      "Run any SQL statement (INSERT/UPDATE/DELETE/DDL) against a configured Postgres connection. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      sql: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ sql, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      requireWritable(conn);
      const result = conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows, rowCount } = await result.client.query(sql);
      return JSON.stringify({ rowCount, rows });
    },
  });

  server.addTool({
    name: "pg_list_tables",
    description: "List all tables in the public schema of a configured Postgres connection.",
    parameters: z.object({ connectionId: connectionIdParam }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_describe_table",
    description: "Describe the columns of a table in a configured Postgres connection.",
    parameters: z.object({
      table: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ table, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
        [table],
      );
      return JSON.stringify(rows);
    },
  });
}

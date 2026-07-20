import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { ConnectionRegistry } from "../connections/registry.js";
import { resolveConnection, requireWritable, throwUnavailable } from "./connection-helpers.js";

const connectionIdParam = z
  .string()
  .optional()
  .describe("Id of the mysql connection to use. Optional when only one mysql connection is configured.");

export function registerMySqlTools(server: FastMCP, registry: ConnectionRegistry): void {
  server.addTool({
    name: "mysql_query",
    description: "Run a read-only SELECT/SHOW/EXPLAIN query against a configured MySQL connection.",
    parameters: z.object({
      sql: z.string().describe("A SELECT, SHOW, or EXPLAIN statement."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ sql, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const [rows] = await result.client.query(sql);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_execute_sql",
    description:
      "Run any SQL statement (INSERT/UPDATE/DELETE/DDL) against a configured MySQL connection. Blocked when readOnly mode is enabled.",
    parameters: z.object({
      sql: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ sql, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const [res] = await result.client.query(sql);
      return JSON.stringify(res);
    },
  });

  server.addTool({
    name: "mysql_list_databases",
    description: "List all databases on a MySQL connection.",
    parameters: z.object({
      connectionId: connectionIdParam,
    }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const [rows] = await result.client.query("SHOW DATABASES");
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_list_tables",
    description: "List tables in a MySQL database.",
    parameters: z.object({
      database: z.string().optional().describe("Optional database name."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ database, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const sql = database ? `SHOW TABLES FROM \`${database.replace(/`/g, "")}\`` : "SHOW TABLES";
      const [rows] = await result.client.query(sql);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_list_views",
    description: "List views in a MySQL database.",
    parameters: z.object({
      database: z.string().optional().describe("Optional database name."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ database, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const sql = `
        SELECT table_name as view_name, security_type, definer, check_option, is_updatable
        FROM information_schema.VIEWS
        ${database ? "WHERE table_schema = ?" : "WHERE table_schema = DATABASE()"}
        ORDER BY table_name
      `;
      const [rows] = await result.client.query(sql, database ? [database] : []);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_describe_table",
    description: "Show column definitions and metadata for a MySQL table.",
    parameters: z.object({
      table: z.string(),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ table, database, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const tableName = database
        ? `\`${database.replace(/`/g, "")}\`.\`${table.replace(/`/g, "")}\``
        : `\`${table.replace(/`/g, "")}\``;
      const [rows] = await result.client.query(`DESCRIBE ${tableName}`);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_show_create_table",
    description: "Get the exact CREATE TABLE DDL statement for a MySQL table.",
    parameters: z.object({
      table: z.string(),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ table, database, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const tableName = database
        ? `\`${database.replace(/`/g, "")}\`.\`${table.replace(/`/g, "")}\``
        : `\`${table.replace(/`/g, "")}\``;
      const [rows] = await result.client.query(`SHOW CREATE TABLE ${tableName}`);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_show_create_view",
    description: "Get the exact CREATE VIEW DDL statement for a MySQL view.",
    parameters: z.object({
      view: z.string(),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ view, database, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const viewName = database
        ? `\`${database.replace(/`/g, "")}\`.\`${view.replace(/`/g, "")}\``
        : `\`${view.replace(/`/g, "")}\``;
      const [rows] = await result.client.query(`SHOW CREATE VIEW ${viewName}`);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_list_indexes",
    description: "Show all indexes for a specified MySQL table.",
    parameters: z.object({
      table: z.string(),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ table, database, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const tableName = database
        ? `\`${database.replace(/`/g, "")}\`.\`${table.replace(/`/g, "")}\``
        : `\`${table.replace(/`/g, "")}\``;
      const [rows] = await result.client.query(`SHOW INDEX FROM ${tableName}`);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_list_triggers",
    description: "List triggers in a MySQL database.",
    parameters: z.object({
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ database, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const sql = database ? `SHOW TRIGGERS FROM \`${database.replace(/`/g, "")}\`` : "SHOW TRIGGERS";
      const [rows] = await result.client.query(sql);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_list_routines",
    description: "List stored procedures and functions in a MySQL database.",
    parameters: z.object({
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ database, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const sql = `
        SELECT routine_name, routine_type, data_type, routine_definition, created, last_altered
        FROM information_schema.ROUTINES
        ${database ? "WHERE routine_schema = ?" : "WHERE routine_schema = DATABASE()"}
        ORDER BY routine_name
      `;
      const [rows] = await result.client.query(sql, database ? [database] : []);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_list_constraints",
    description: "List table constraints and foreign keys in a MySQL database.",
    parameters: z.object({
      table: z.string().optional(),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ table, database, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      let sql = `
        SELECT constraint_name, table_name, constraint_type
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE 1=1
      `;
      const params: string[] = [];
      if (database) {
        sql += " AND table_schema = ?";
        params.push(database);
      } else {
        sql += " AND table_schema = DATABASE()";
      }
      if (table) {
        sql += " AND table_name = ?";
        params.push(table);
      }
      const [rows] = await result.client.query(sql, params);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_table_stats",
    description: "Get size, row count estimates, and index sizes for tables in a MySQL database.",
    parameters: z.object({
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ database, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const sql = `
        SELECT table_name, table_rows, data_length, index_length, (data_length + index_length) as total_size
        FROM information_schema.TABLES
        ${database ? "WHERE table_schema = ?" : "WHERE table_schema = DATABASE()"}
        ORDER BY total_size DESC
      `;
      const [rows] = await result.client.query(sql, database ? [database] : []);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_active_queries",
    description: "List currently running queries and processes in MySQL.",
    parameters: z.object({
      connectionId: connectionIdParam,
    }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const [rows] = await result.client.query("SHOW FULL PROCESSLIST");
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_kill_query",
    description: "Kill a running query or connection thread by ID in MySQL. Blocked when readOnly mode is enabled.",
    parameters: z.object({
      processId: z.number().describe("The ID of the process to kill."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ processId, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      await result.client.query(`KILL QUERY ${Number(processId)}`);
      return JSON.stringify({ success: true, killedProcessId: processId });
    },
  });

  server.addTool({
    name: "mysql_explain_query",
    description: "Get the execution plan for a MySQL query.",
    parameters: z.object({
      sql: z.string().describe("The query to EXPLAIN."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ sql, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const [rows] = await result.client.query(`EXPLAIN ${sql}`);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_global_status",
    description: "Show server status variables in MySQL.",
    parameters: z.object({
      filter: z.string().optional().describe("Pattern to filter variable names (e.g. 'Threads_%' or 'Qcache_%')."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ filter, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const sql = filter ? `SHOW GLOBAL STATUS LIKE ${result.client.escape(filter)}` : "SHOW GLOBAL STATUS";
      const [rows] = await result.client.query(sql);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "mysql_analyze_table",
    description: "Analyze key distribution for a MySQL table. Blocked when readOnly mode is enabled.",
    parameters: z.object({
      table: z.string(),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ table, database, connectionId }) => {
      const conn = resolveConnection(registry, "mysql", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const tableName = database
        ? `\`${database.replace(/`/g, "")}\`.\`${table.replace(/`/g, "")}\``
        : `\`${table.replace(/`/g, "")}\``;
      const [rows] = await result.client.query(`ANALYZE TABLE ${tableName}`);
      return JSON.stringify(rows);
    },
  });
}

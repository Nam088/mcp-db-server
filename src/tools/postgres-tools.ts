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

const schemaParam = z
  .string()
  .optional()
  .describe("Schema to filter by. Defaults to the connection's defaultSchema (or 'public').");

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
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      // Passing an (empty) params array forces node-postgres onto the extended query
      // protocol, which (unlike the simple protocol used when no params are given)
      // rejects a query string containing more than one ;-separated statement. That
      // stops a "SELECT ...; DROP TABLE ..." payload from riding along on a tool that's
      // documented as read-only.
      const { rows } = await result.client.query(sql, []);
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
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows, rowCount } = await result.client.query(sql);
      return JSON.stringify({ rowCount, rows });
    },
  });

  server.addTool({
    name: "pg_list_tables",
    description: "List all tables in the specified schema of a configured Postgres connection.",
    parameters: z.object({
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
        [targetSchema],
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_describe_table",
    description: "Describe the columns of a table in the specified schema of a configured Postgres connection.",
    parameters: z.object({
      table: z.string(),
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ table, schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        [targetSchema, table],
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_list_schemas",
    description: "List all database schemas.",
    parameters: z.object({ connectionId: connectionIdParam }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        "SELECT schema_name FROM information_schema.schemata ORDER BY schema_name",
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_list_views",
    description: "List all views in the specified schema.",
    parameters: z.object({
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        "SELECT viewname AS view_name FROM pg_catalog.pg_views WHERE schemaname = $1 ORDER BY viewname",
        [targetSchema],
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_list_indexes",
    description: "List all indexes for a given table in the specified schema.",
    parameters: z.object({
      table: z.string(),
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ table, schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        "SELECT indexname AS index_name, indexdef AS index_definition FROM pg_catalog.pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname",
        [targetSchema, table],
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_list_triggers",
    description: "List all triggers in the specified schema.",
    parameters: z.object({
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        "SELECT trigger_name, event_manipulation, event_object_table, action_statement FROM information_schema.triggers WHERE trigger_schema = $1 ORDER BY trigger_name",
        [targetSchema],
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_table_stats",
    description: "Get statistics for a given table in the specified schema, including table size, index size, and estimated row count.",
    parameters: z.object({
      table: z.string(),
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ table, schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        `SELECT 
          pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
          pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
          pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS index_size,
          c.reltuples::bigint AS row_estimate
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2`,
        [targetSchema, table],
      );
      return JSON.stringify(rows[0] || null);
    },
  });

  server.addTool({
    name: "pg_list_constraints",
    description: "List constraints (foreign keys, primary keys, check constraints) on a table in the specified schema.",
    parameters: z.object({
      table: z.string(),
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ table, schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const qualifiedTable = `"${targetSchema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
      const { rows } = await result.client.query(
        `SELECT
          conname AS constraint_name,
          contype AS constraint_type,
          pg_get_constraintdef(oid) AS constraint_definition
        FROM pg_constraint
        WHERE conrelid = $1::regclass`,
        [qualifiedTable],
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_explain_query",
    description: "Run EXPLAIN on a read-only SELECT query to analyze query performance.",
    parameters: z.object({
      sql: z.string().describe("A SELECT statement."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ sql, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(`EXPLAIN ${sql}`, []);
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_active_queries",
    description: "Get active queries currently running on the server.",
    parameters: z.object({ connectionId: connectionIdParam }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        `SELECT pid, state, query, age(clock_timestamp(), query_start) AS duration, usename 
        FROM pg_stat_activity 
        WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%' 
        ORDER BY query_start DESC`,
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_list_functions",
    description: "List all user-defined functions in the specified schema.",
    parameters: z.object({
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        `SELECT proname AS function_name, pg_get_function_arguments(p.oid) AS arguments, pg_get_function_result(p.oid) AS result_type
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = $1
        ORDER BY proname`,
        [targetSchema],
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_list_sequences",
    description: "List all sequences in the specified schema.",
    parameters: z.object({
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = $1 ORDER BY sequence_name",
        [targetSchema],
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_database_info",
    description: "Get metadata and size information about the current database.",
    parameters: z.object({ connectionId: connectionIdParam }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        `SELECT 
          current_database() AS database_name,
          current_user AS current_user,
          version() AS postgres_version,
          pg_size_pretty(pg_database_size(current_database())) AS database_size`,
      );
      return JSON.stringify(rows[0] || null);
    },
  });

  server.addTool({
    name: "pg_kill_query",
    description: "Terminate an active query by PID. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      pid: z.number().int().describe("Process ID of the query to terminate"),
      connectionId: connectionIdParam,
    }),
    execute: async ({ pid, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query("SELECT pg_terminate_backend($1) AS terminated", [pid]);
      return JSON.stringify(rows[0] || null);
    },
  });

  server.addTool({
    name: "pg_vacuum_analyze",
    description: "Run VACUUM ANALYZE on a table to clean dead tuples and update database statistics. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      table: z.string().describe("Table to vacuum/analyze"),
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ table, schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const safeSchema = targetSchema.replace(/"/g, '""');
      const safeTable = table.replace(/"/g, '""');
      await result.client.query(`VACUUM ANALYZE "${safeSchema}"."${safeTable}"`);
      return JSON.stringify({ success: true, table: `${targetSchema}.${table}` });
    },
  });

  server.addTool({
    name: "pg_list_materialized_views",
    description: "List all materialized views in the specified schema.",
    parameters: z.object({
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        "SELECT matviewname AS view_name FROM pg_catalog.pg_matviews WHERE schemaname = $1 ORDER BY matviewname",
        [targetSchema],
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_refresh_materialized_view",
    description: "Refresh a materialized view. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      view: z.string().describe("Materialized view name"),
      concurrently: z.boolean().optional().describe("Whether to refresh concurrently (requires unique index on the view)"),
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ view, concurrently, schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const safeSchema = targetSchema.replace(/"/g, '""');
      const safeView = view.replace(/"/g, '""');
      const concurrentClause = concurrently ? "CONCURRENTLY" : "";
      await result.client.query(`REFRESH MATERIALIZED VIEW ${concurrentClause} "${safeSchema}"."${safeView}"`);
      return JSON.stringify({ success: true, view: `${targetSchema}.${view}`, concurrently: !!concurrently });
    },
  });

  server.addTool({
    name: "pg_index_usage",
    description: "Retrieve index usage statistics for all user tables in the specified schema.",
    parameters: z.object({
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        `SELECT
          schemaname AS schema_name,
          relname AS table_name,
          indexrelname AS index_name,
          idx_scan AS index_scans,
          idx_tup_read AS tuples_read,
          idx_tup_fetch AS tuples_fetched
        FROM pg_stat_user_indexes
        WHERE schemaname = $1
        ORDER BY idx_scan DESC`,
        [targetSchema],
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_lock_info",
    description: "Get active lock information from the database catalog.",
    parameters: z.object({ connectionId: connectionIdParam }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(
        `SELECT
          pg_stat_activity.pid,
          pg_locks.mode,
          pg_locks.locktype,
          pg_locks.granted,
          pg_stat_activity.query,
          age(clock_timestamp(), pg_stat_activity.query_start) AS query_duration
        FROM pg_catalog.pg_locks
        JOIN pg_catalog.pg_stat_activity ON pg_catalog.pg_stat_activity.pid = pg_catalog.pg_locks.pid
        WHERE pg_stat_activity.pid != pg_backend_pid()
        ORDER BY query_duration DESC`,
      );
      return JSON.stringify(rows);
    },
  });

  server.addTool({
    name: "pg_get_top_queries",
    description: "Get the slowest SQL queries based on execution time from pg_stat_statements (if the extension is enabled).",
    parameters: z.object({
      limit: z.number().optional().default(10).describe("Maximum number of slow queries to return."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ limit, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      try {
        const { rows } = await result.client.query(
          `SELECT query, calls, 
                  round(total_exec_time::numeric, 2) AS total_time_ms, 
                  round(mean_exec_time::numeric, 2) AS mean_time_ms 
           FROM pg_stat_statements 
           ORDER BY total_exec_time DESC 
           LIMIT $1`,
          [limit]
        );
        return JSON.stringify(rows);
      } catch (err) {
        try {
          const { rows } = await result.client.query(
            `SELECT query, calls, 
                    round(total_time::numeric, 2) AS total_time_ms, 
                    round(mean_time::numeric, 2) AS mean_time_ms 
             FROM pg_stat_statements 
             ORDER BY total_time DESC 
             LIMIT $1`,
            [limit]
          );
          return JSON.stringify(rows);
        } catch (innerErr) {
          return JSON.stringify({
            error: "pg_stat_statements extension is not installed or enabled in shared_preload_libraries. Run 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements;' or enable it in postgresql.conf."
          });
        }
      }
    },
  });

  server.addTool({
    name: "pg_explain_hypothetical_index",
    description: "Explain a query's execution plan simulating hypothetical indexes using the hypopg extension (if installed).",
    parameters: z.object({
      sql: z.string().describe("The SELECT query to explain (do NOT use EXPLAIN ANALYZE)."),
      indexes: z.array(z.string()).describe("Array of index definitions (e.g. ['CREATE INDEX ON users (email)'])."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ sql, indexes, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const client = await result.client.connect();
      try {
        try {
          await client.query("SELECT * FROM hypopg_reset()");
        } catch {
          return JSON.stringify({
            error: "hypopg extension is not installed. Please install it on the PostgreSQL server and run 'CREATE EXTENSION IF NOT EXISTS hypopg;' to use hypothetical indexes."
          });
        }
        const createdIndexes = [];
        for (const indexDef of indexes) {
          const res = await client.query(`SELECT * FROM hypopg_create_index($1)`, [indexDef]);
          if (res.rows.length > 0) {
            createdIndexes.push(res.rows[0]);
          }
        }
        const cleanSql = sql.replace(/^\s*explain\s+(analyze\s+)?/i, "");
        const explainRes = await client.query(`EXPLAIN ${cleanSql}`, []);
        await client.query("SELECT * FROM hypopg_reset()");
        return JSON.stringify({
          created_hypothetical_indexes: createdIndexes,
          explain_plan: explainRes.rows.map(r => r["QUERY PLAN"] || Object.values(r)[0])
        });
      } finally {
        client.release();
      }
    },
  });

  server.addTool({
    name: "pg_database_health",
    description: "Get a comprehensive database health report (connections, buffer cache, invalid indexes, dead rows, and replication).",
    parameters: z.object({ connectionId: connectionIdParam }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);

      const healthReport: Record<string, any> = {};

      // 1. Connection Utilization
      try {
        const { rows } = await result.client.query(`
          SELECT 
            count(*) AS active_connections,
            (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS max_connections
          FROM pg_stat_activity
        `);
        if (rows.length > 0) {
          const active = rows[0].active_connections;
          const max = rows[0].max_connections;
          healthReport.connections = {
            active,
            max,
            utilization_percentage: roundToTwoDecimals((active / max) * 100)
          };
        }
      } catch (err: any) {
        healthReport.connections = { error: err.message };
      }

      // 2. Buffer Cache Hit Ratio
      try {
        const { rows } = await result.client.query(`
          SELECT 
            sum(blks_hit) AS hits,
            sum(blks_read) AS reads
          FROM pg_stat_database
        `);
        if (rows.length > 0) {
          const hits = Number(rows[0].hits || 0);
          const reads = Number(rows[0].reads || 0);
          const total = hits + reads;
          healthReport.buffer_cache = {
            hits,
            reads,
            hit_ratio_percentage: total > 0 ? roundToTwoDecimals((hits / total) * 100) : 100
          };
        }
      } catch (err: any) {
        healthReport.buffer_cache = { error: err.message };
      }

      // 3. Invalid Indexes
      try {
        const { rows } = await result.client.query(`
          SELECT 
            coalesce(schemaname, 'unknown') AS schema_name,
            relname AS table_name,
            indexrelname AS index_name
          FROM pg_stat_user_indexes ui
          JOIN pg_index i ON ui.indexrelid = i.indexrelid
          WHERE NOT i.indisvalid
        `);
        healthReport.invalid_indexes = {
          count: rows.length,
          indexes: rows
        };
      } catch (err: any) {
        healthReport.invalid_indexes = { error: err.message };
      }

      // 4. Vacuum & Dead Rows (Autovacuum Health)
      try {
        const { rows } = await result.client.query(`
          SELECT 
            schemaname AS schema_name,
            relname AS table_name, 
            n_dead_tup AS dead_rows,
            last_autovacuum,
            last_vacuum
          FROM pg_stat_user_tables 
          WHERE n_dead_tup > 1000
          ORDER BY n_dead_tup DESC 
          LIMIT 10
        `);
        healthReport.vacuum_health = {
          tables_needing_vacuum_count: rows.length,
          top_bloated_tables: rows
        };
      } catch (err: any) {
        healthReport.vacuum_health = { error: err.message };
      }

      // 5. Replication Status
      try {
        const { rows } = await result.client.query(`
          SELECT 
            client_addr, 
            state, 
            sync_state,
            pg_wal_lsn_diff(pg_current_wal_lsn(), sent_lsn) AS sent_lag_bytes,
            pg_wal_lsn_diff(pg_current_wal_lsn(), write_lsn) AS write_lag_bytes,
            pg_wal_lsn_diff(pg_current_wal_lsn(), flush_lsn) AS flush_lag_bytes,
            pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS replay_lag_bytes
          FROM pg_stat_replication
        `);
        healthReport.replication = {
          is_replica: false,
          active_replicas_count: rows.length,
          replicas: rows
        };
      } catch (err: any) {
        // If pg_current_wal_lsn fails because we are on a replica, check recovery status
        try {
          const recoveryRes = await result.client.query(`SELECT pg_is_in_recovery() AS is_recovery`);
          const isReplica = recoveryRes.rows[0]?.is_recovery || false;
          healthReport.replication = {
            is_replica: isReplica,
            status: isReplica ? "Running as Read-Only Replica" : "Standalone Primary"
          };
        } catch {
          healthReport.replication = { error: err.message };
        }
      }

      return JSON.stringify(healthReport);
    },
  });

  server.addTool({
    name: "pg_sizes_overview",
    description: "Get size statistics for the database and all tables/indexes in a schema.",
    parameters: z.object({
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);

      const dbSizeRes = await result.client.query(`
        SELECT 
          current_database() AS database_name,
          pg_size_pretty(pg_database_size(current_database())) AS database_size,
          pg_database_size(current_database()) AS database_size_bytes
      `);

      const tablesSizeRes = await result.client.query(`
        SELECT 
          relname AS table_name,
          pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
          pg_size_pretty(pg_indexes_size(c.oid)) AS index_size,
          pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
          pg_relation_size(c.oid) AS table_size_bytes,
          pg_indexes_size(c.oid) AS index_size_bytes,
          pg_total_relation_size(c.oid) AS total_size_bytes
        FROM pg_class c
        LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relkind = 'r'
        ORDER BY total_size_bytes DESC
      `, [targetSchema]);

      return JSON.stringify({
        database: dbSizeRes.rows[0] || null,
        schema: targetSchema,
        tables: tablesSizeRes.rows
      });
    }
  });

  // --- Index Analysis Tools ---

  server.addTool({
    name: "pg_unused_indexes",
    description: "Find indexes that have never been used (zero scans since last stats reset). Great for identifying candidates to DROP to save space and reduce write overhead.",
    parameters: z.object({
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(`
        SELECT
          schemaname AS schema_name,
          relname AS table_name,
          indexrelname AS index_name,
          pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
          pg_relation_size(indexrelid) AS index_size_bytes,
          idx_scan AS times_used
        FROM pg_stat_user_indexes
        WHERE schemaname = $1
          AND idx_scan = 0
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint c
            WHERE c.conindid = indexrelid
          )
        ORDER BY pg_relation_size(indexrelid) DESC
      `, [targetSchema]);
      return JSON.stringify({ schema: targetSchema, unused_indexes: rows, count: rows.length });
    }
  });

  server.addTool({
    name: "pg_duplicate_indexes",
    description: "Find redundant indexes where one index's leading columns are a subset of another, making the smaller one unnecessary.",
    parameters: z.object({
      schema: schemaParam,
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(`
        SELECT
          i1.relname AS table_name,
          ix1.indexrelid::regclass::text AS duplicate_index,
          ix2.indexrelid::regclass::text AS covered_by_index,
          array_to_string(array_agg(a1.attname ORDER BY ki1.indseqno), ', ') AS duplicate_columns,
          pg_size_pretty(pg_relation_size(ix1.indexrelid)) AS wasted_size,
          pg_relation_size(ix1.indexrelid) AS wasted_size_bytes
        FROM pg_index ix1
        JOIN pg_index ix2 ON ix1.indrelid = ix2.indrelid AND ix1.indexrelid <> ix2.indexrelid
        JOIN pg_class i1 ON i1.oid = ix1.indrelid
        JOIN pg_namespace n ON n.oid = i1.relnamespace
        JOIN LATERAL unnest(ix1.indkey) WITH ORDINALITY AS ki1(attnum, indseqno) ON true
        JOIN pg_attribute a1 ON a1.attrelid = ix1.indrelid AND a1.attnum = ki1.attnum
        WHERE n.nspname = $1
          AND NOT ix1.indisprimary
          AND NOT ix1.indisunique
          AND ix1.indisvalid
          AND ix1.indkey::int[] <@ ix2.indkey::int[]
          AND ix1.indkey[0] = ix2.indkey[0]
        GROUP BY i1.relname, ix1.indexrelid, ix2.indexrelid
        ORDER BY wasted_size_bytes DESC
      `, [targetSchema]);
      return JSON.stringify({ schema: targetSchema, duplicate_indexes: rows, count: rows.length });
    }
  });

  server.addTool({
    name: "pg_long_running_queries",
    description: "Find queries that have been running longer than a given threshold in seconds.",
    parameters: z.object({
      min_duration_seconds: z.number().optional().default(30).describe("Minimum duration in seconds to consider a query as long-running (default: 30)."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ min_duration_seconds, connectionId }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(`
        SELECT
          pid,
          usename AS username,
          datname AS database,
          state,
          wait_event_type,
          wait_event,
          extract(epoch FROM (now() - query_start))::int AS duration_seconds,
          left(query, 200) AS query_preview
        FROM pg_stat_activity
        WHERE state != 'idle'
          AND query_start IS NOT NULL
          AND now() - query_start > ($1 || ' seconds')::interval
        ORDER BY duration_seconds DESC
      `, [min_duration_seconds]);
      return JSON.stringify({
        min_duration_seconds,
        long_running_queries: rows,
        count: rows.length
      });
    }
  });

  server.addTool({
    name: "pg_missing_indexes",
    description: "Find tables that have high sequential scan counts relative to index scans, suggesting they might benefit from new indexes.",
    parameters: z.object({
      schema: schemaParam,
      min_seq_scans: z.number().optional().default(100).describe("Minimum number of sequential scans to include a table (default: 100)."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId, min_seq_scans }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(`
        SELECT
          schemaname AS schema_name,
          relname AS table_name,
          seq_scan,
          idx_scan,
          seq_tup_read,
          n_live_tup AS estimated_row_count,
          CASE WHEN (seq_scan + idx_scan) > 0
            THEN round(100.0 * idx_scan / (seq_scan + idx_scan), 2)
            ELSE 0
          END AS index_hit_ratio_pct
        FROM pg_stat_user_tables
        WHERE schemaname = $1
          AND seq_scan >= $2
        ORDER BY seq_scan DESC
      `, [targetSchema, min_seq_scans]);
      return JSON.stringify({
        schema: targetSchema,
        min_seq_scans,
        tables: rows,
        count: rows.length
      });
    }
  });

  server.addTool({
    name: "pg_bloat_estimate",
    description: "Estimate table and index bloat using pg_stat_user_tables statistics (dead tuples vs live tuples ratio). Returns tables where dead tuple ratio exceeds a threshold.",
    parameters: z.object({
      schema: schemaParam,
      min_dead_ratio_pct: z.number().optional().default(10).describe("Minimum dead tuple percentage to include (default: 10%)."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ schema, connectionId, min_dead_ratio_pct }) => {
      const conn = resolveConnection(registry, "postgres", connectionId);
      const targetSchema = schema ?? conn.defaultSchema;
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { rows } = await result.client.query(`
        SELECT
          schemaname AS schema_name,
          relname AS table_name,
          n_live_tup AS live_rows,
          n_dead_tup AS dead_rows,
          CASE WHEN (n_live_tup + n_dead_tup) > 0
            THEN round(100.0 * n_dead_tup / (n_live_tup + n_dead_tup), 2)
            ELSE 0
          END AS dead_ratio_pct,
          last_vacuum,
          last_autovacuum,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) AS total_size
        FROM pg_stat_user_tables
        WHERE schemaname = $1
          AND (n_live_tup + n_dead_tup) > 0
          AND (100.0 * n_dead_tup / (n_live_tup + n_dead_tup)) >= $2
        ORDER BY dead_ratio_pct DESC
      `, [targetSchema, min_dead_ratio_pct]);
      return JSON.stringify({
        schema: targetSchema,
        min_dead_ratio_pct,
        bloated_tables: rows,
        count: rows.length
      });
    }
  });
}

function roundToTwoDecimals(num: number): number {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

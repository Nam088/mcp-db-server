import { describe, it, expect } from "vitest";
import { UserError } from "fastmcp";
import { registerPostgresTools } from "../../src/tools/postgres-tools.js";

class FakeServer {
  public tools: Record<string, { execute: (args: never) => Promise<string> }> = {};
  addTool(def: { name: string; execute: (args: never) => Promise<string> }): void {
    this.tools[def.name] = def;
  }
}

function makeFakeRegistry(readOnly: boolean, getClientResult: unknown) {
  const conn = {
    id: "primary-pg",
    type: "postgres",
    readOnly,
    defaultSchema: "public",
    getClient: () => getClientResult,
  };
  return {
    get: () => conn,
    findOneByType: () => conn,
    countByType: () => 1,
  };
}

describe("postgres tools", () => {
  it("pg_query runs the SQL against the live client and returns rows as JSON", async () => {
    const query = async () => ({ rows: [{ id: 1 }] });
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_query.execute({ sql: "SELECT 1" } as never);
    expect(JSON.parse(result)).toEqual([{ id: 1 }]);
  });

  it("pg_query passes an empty params array to force the extended query protocol, blocking stacked statements", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toBe("SELECT 1; DROP TABLE users;--");
      expect(params).toEqual([]);
      return { rows: [{ id: 1 }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    await server.tools.pg_query.execute({ sql: "SELECT 1; DROP TABLE users;--" } as never);
  });

  it("pg_query throws UserError with the connection status when the connection is unavailable", async () => {
    const status = { id: "primary-pg", type: "postgres", state: "failed" as const, readOnly: true };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: false, status }) as never);

    await expect(server.tools.pg_query.execute({ sql: "SELECT 1" } as never)).rejects.toThrow(UserError);
  });

  it("pg_execute_sql refuses to run when the resolved connection's readOnly is true", async () => {
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);

    await expect(server.tools.pg_execute_sql.execute({ sql: "DELETE FROM users" } as never)).rejects.toThrow(
      /READ_ONLY/,
    );
  });

  it("pg_execute_sql runs when the resolved connection's readOnly is false", async () => {
    const query = async () => ({ rows: [], rowCount: 0 });
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(false, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_execute_sql.execute({ sql: "DELETE FROM users" } as never);
    expect(JSON.parse(result)).toEqual({ rowCount: 0, rows: [] });
  });

  it("pg_list_schemas returns list of schemas", async () => {
    const query = async (sql: string) => {
      expect(sql).toContain("schema_name FROM information_schema.schemata");
      return { rows: [{ schema_name: "public" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_list_schemas.execute({} as never);
    expect(JSON.parse(result)).toEqual([{ schema_name: "public" }]);
  });

  it("pg_list_views returns list of views", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("viewname AS view_name FROM pg_catalog.pg_views");
      expect(params).toEqual(["public"]);
      return { rows: [{ view_name: "my_view" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_list_views.execute({} as never);
    expect(JSON.parse(result)).toEqual([{ view_name: "my_view" }]);
  });

  it("pg_list_indexes returns indexes for a table", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("indexname AS index_name, indexdef AS index_definition FROM pg_catalog.pg_indexes");
      expect(params).toEqual(["public", "my_table"]);
      return { rows: [{ index_name: "my_index", index_definition: "CREATE INDEX..." }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_list_indexes.execute({ table: "my_table" } as never);
    expect(JSON.parse(result)).toEqual([{ index_name: "my_index", index_definition: "CREATE INDEX..." }]);
  });

  it("pg_list_triggers returns triggers", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("trigger_name, event_manipulation, event_object_table, action_statement FROM information_schema.triggers");
      expect(params).toEqual(["public"]);
      return { rows: [{ trigger_name: "my_trigger" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_list_triggers.execute({} as never);
    expect(JSON.parse(result)).toEqual([{ trigger_name: "my_trigger" }]);
  });

  it("pg_table_stats returns stats for table", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("pg_total_relation_size(c.oid)");
      expect(params).toEqual(["public", "my_table"]);
      return { rows: [{ total_size: "10 MB", table_size: "8 MB", index_size: "2 MB", row_estimate: 1000 }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_table_stats.execute({ table: "my_table" } as never);
    expect(JSON.parse(result)).toEqual({ total_size: "10 MB", table_size: "8 MB", index_size: "2 MB", row_estimate: 1000 });
  });

  it("pg_list_constraints returns constraints on a table", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("pg_constraint");
      expect(params).toEqual(['"public"."my_table"']);
      return { rows: [{ constraint_name: "pk_my_table", constraint_type: "p", constraint_definition: "PRIMARY KEY" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_list_constraints.execute({ table: "my_table" } as never);
    expect(JSON.parse(result)).toEqual([{ constraint_name: "pk_my_table", constraint_type: "p", constraint_definition: "PRIMARY KEY" }]);
  });

  it("pg_explain_query runs EXPLAIN and returns rows", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toBe("EXPLAIN SELECT 1");
      expect(params).toEqual([]);
      return { rows: [{ "QUERY PLAN": "Result  (cost=0.00..0.01 rows=1 width=4)" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_explain_query.execute({ sql: "SELECT 1" } as never);
    expect(JSON.parse(result)).toEqual([{ "QUERY PLAN": "Result  (cost=0.00..0.01 rows=1 width=4)" }]);
  });

  it("pg_active_queries returns running queries", async () => {
    const query = async (sql: string) => {
      expect(sql).toContain("pg_stat_activity");
      return { rows: [{ pid: 123, state: "active", query: "SELECT 1" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_active_queries.execute({} as never);
    expect(JSON.parse(result)).toEqual([{ pid: 123, state: "active", query: "SELECT 1" }]);
  });

  it("pg_list_functions returns user functions", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("proname AS function_name");
      expect(params).toEqual(["public"]);
      return { rows: [{ function_name: "my_func", arguments: "integer", result_type: "boolean" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_list_functions.execute({} as never);
    expect(JSON.parse(result)).toEqual([{ function_name: "my_func", arguments: "integer", result_type: "boolean" }]);
  });

  it("pg_list_sequences returns sequences", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("sequence_name FROM information_schema.sequences");
      expect(params).toEqual(["public"]);
      return { rows: [{ sequence_name: "my_seq" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_list_sequences.execute({} as never);
    expect(JSON.parse(result)).toEqual([{ sequence_name: "my_seq" }]);
  });

  it("pg_database_info returns metadata about connected database", async () => {
    const query = async (sql: string) => {
      expect(sql).toContain("current_database() AS database_name");
      return { rows: [{ database_name: "mydb", current_user: "me", postgres_version: "15", database_size: "10 MB" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_database_info.execute({} as never);
    expect(JSON.parse(result)).toEqual({ database_name: "mydb", current_user: "me", postgres_version: "15", database_size: "10 MB" });
  });

  it("pg_kill_query terminates running query and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerPostgresTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.pg_kill_query.execute({ pid: 1234 } as never)).rejects.toThrow(/READ_ONLY/);

    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toBe("SELECT pg_terminate_backend($1) AS terminated");
      expect(params).toEqual([1234]);
      return { rows: [{ terminated: true }] };
    };
    const serverWritable = new FakeServer();
    registerPostgresTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client: { query } }) as never);
    const result = await serverWritable.tools.pg_kill_query.execute({ pid: 1234 } as never);
    expect(JSON.parse(result)).toEqual({ terminated: true });
  });

  it("pg_vacuum_analyze runs vacuum analyze and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerPostgresTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.pg_vacuum_analyze.execute({ table: "my_table" } as never)).rejects.toThrow(/READ_ONLY/);

    const query = async (sql: string) => {
      expect(sql).toBe('VACUUM ANALYZE "public"."my_table"');
      return { rows: [] };
    };
    const serverWritable = new FakeServer();
    registerPostgresTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client: { query } }) as never);
    const result = await serverWritable.tools.pg_vacuum_analyze.execute({ table: "my_table" } as never);
    expect(JSON.parse(result)).toEqual({ success: true, table: "public.my_table" });
  });

  it("pg_vacuum_analyze escapes a schema name containing a double quote instead of interpolating it raw", async () => {
    const query = async (sql: string) => {
      expect(sql).toBe('VACUUM ANALYZE "evil""; DROP TABLE users;--"."my_table"');
      return { rows: [] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(false, { ok: true, client: { query } }) as never);

    await server.tools.pg_vacuum_analyze.execute({ table: "my_table", schema: 'evil"; DROP TABLE users;--' } as never);
  });

  it("pg_list_materialized_views returns materialized views", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("matviewname AS view_name FROM pg_catalog.pg_matviews");
      expect(params).toEqual(["public"]);
      return { rows: [{ view_name: "my_matview" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_list_materialized_views.execute({} as never);
    expect(JSON.parse(result)).toEqual([{ view_name: "my_matview" }]);
  });

  it("pg_refresh_materialized_view refreshes view and respects readOnly", async () => {
    const serverReadOnly = new FakeServer();
    registerPostgresTools(serverReadOnly as never, makeFakeRegistry(true, { ok: true, client: {} }) as never);
    await expect(serverReadOnly.tools.pg_refresh_materialized_view.execute({ view: "my_view" } as never)).rejects.toThrow(/READ_ONLY/);

    let expectedSql = 'REFRESH MATERIALIZED VIEW  "public"."my_view"';
    const query = async (sql: string) => {
      expect(sql).toBe(expectedSql);
      return { rows: [] };
    };
    const serverWritable = new FakeServer();
    registerPostgresTools(serverWritable as never, makeFakeRegistry(false, { ok: true, client: { query } }) as never);
    
    let result = await serverWritable.tools.pg_refresh_materialized_view.execute({ view: "my_view" } as never);
    expect(JSON.parse(result)).toEqual({ success: true, view: "public.my_view", concurrently: false });

    expectedSql = 'REFRESH MATERIALIZED VIEW CONCURRENTLY "public"."my_view"';
    result = await serverWritable.tools.pg_refresh_materialized_view.execute({ view: "my_view", concurrently: true } as never);
    expect(JSON.parse(result)).toEqual({ success: true, view: "public.my_view", concurrently: true });
  });

  it("pg_refresh_materialized_view escapes a schema name containing a double quote instead of interpolating it raw", async () => {
    const query = async (sql: string) => {
      expect(sql).toBe('REFRESH MATERIALIZED VIEW  "evil""; DROP TABLE users;--"."my_view"');
      return { rows: [] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(false, { ok: true, client: { query } }) as never);

    await server.tools.pg_refresh_materialized_view.execute({
      view: "my_view",
      schema: 'evil"; DROP TABLE users;--',
    } as never);
  });

  it("pg_index_usage returns index statistics", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("pg_stat_user_indexes");
      expect(params).toEqual(["public"]);
      return { rows: [{ schema_name: "public", table_name: "my_table", index_name: "my_index", index_scans: 100 }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_index_usage.execute({} as never);
    expect(JSON.parse(result)).toEqual([{ schema_name: "public", table_name: "my_table", index_name: "my_index", index_scans: 100 }]);
  });

  it("pg_lock_info returns active lock info", async () => {
    const query = async (sql: string) => {
      expect(sql).toContain("pg_locks");
      return { rows: [{ pid: 1234, mode: "ExclusiveLock", locktype: "relation", granted: true }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_lock_info.execute({} as never);
    expect(JSON.parse(result)).toEqual([{ pid: 1234, mode: "ExclusiveLock", locktype: "relation", granted: true }]);
  });

  it("pg_get_top_queries returns slowest queries from pg_stat_statements", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("pg_stat_statements");
      expect(params).toEqual([5]);
      return { rows: [{ query: "SELECT 1", calls: 100, total_time_ms: 50.5, mean_time_ms: 0.5 }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_get_top_queries.execute({ limit: 5 } as never);
    expect(JSON.parse(result)).toEqual([{ query: "SELECT 1", calls: 100, total_time_ms: 50.5, mean_time_ms: 0.5 }]);
  });

  it("pg_explain_hypothetical_index creates hypothetical index, explains query and resets", async () => {
    const executedQueries: { sql: string; params?: unknown[] }[] = [];
    const mockClient = {
      query: async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params });
        if (sql.includes("hypopg_create_index")) {
          return { rows: [{ indexrelid: 12345, indexname: "<12345>btree_users_email" }] };
        }
        if (sql.includes("EXPLAIN")) {
          return { rows: [{ "QUERY PLAN": "Index Scan using <12345>btree_users_email" }] };
        }
        return { rows: [] };
      },
      release: () => {}
    };
    const mockPool = {
      connect: async () => mockClient
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: mockPool }) as never);

    const result = await server.tools.pg_explain_hypothetical_index.execute({
      sql: "SELECT * FROM users WHERE email = 'a@b.com'",
      indexes: ["CREATE INDEX ON users (email)"]
    } as never);

    expect(executedQueries[0].sql).toBe("SELECT * FROM hypopg_reset()");
    expect(executedQueries[1].sql).toBe("SELECT * FROM hypopg_create_index($1)");
    expect(executedQueries[1].params).toEqual(["CREATE INDEX ON users (email)"]);
    expect(executedQueries[2].sql).toBe("EXPLAIN SELECT * FROM users WHERE email = 'a@b.com'");
    expect(executedQueries[2].params).toEqual([]);
    expect(executedQueries[3].sql).toBe("SELECT * FROM hypopg_reset()");

    expect(JSON.parse(result)).toEqual({
      created_hypothetical_indexes: [{ indexrelid: 12345, indexname: "<12345>btree_users_email" }],
      explain_plan: ["Index Scan using <12345>btree_users_email"]
    });
  });

  it("pg_database_health executes queries and returns diagnostic report", async () => {
    const query = async (sql: string) => {
      if (sql.includes("pg_stat_activity")) {
        return { rows: [{ active_connections: 5, max_connections: 100 }] };
      }
      if (sql.includes("pg_stat_database")) {
        return { rows: [{ hits: 98000, reads: 2000 }] };
      }
      if (sql.includes("pg_index")) {
        return { rows: [{ schema_name: "public", table_name: "users", index_name: "idx_users_email" }] };
      }
      if (sql.includes("pg_stat_user_tables")) {
        return { rows: [{ schemaname: "public", relname: "users", n_dead_tup: 5000, last_autovacuum: null, last_vacuum: null }] };
      }
      if (sql.includes("pg_stat_replication")) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_database_health.execute({} as never);
    const parsed = JSON.parse(result);

    expect(parsed.connections).toEqual({ active: 5, max: 100, utilization_percentage: 5 });
    expect(parsed.buffer_cache).toEqual({ hits: 98000, reads: 2000, hit_ratio_percentage: 98 });
    expect(parsed.invalid_indexes.count).toBe(1);
    expect(parsed.vacuum_health.tables_needing_vacuum_count).toBe(1);
    expect(parsed.replication.active_replicas_count).toBe(0);
  });

  it("pg_sizes_overview queries database and table sizes and returns report", async () => {
    const query = async (sql: string, params?: unknown[]) => {
      if (sql.includes("pg_database_size")) {
        return { rows: [{ database_name: "test_db", database_size: "100 MB", database_size_bytes: 104857600 }] };
      }
      if (sql.includes("pg_relation_size")) {
        expect(params).toEqual(["public"]);
        return {
          rows: [
            {
              table_name: "users",
              table_size: "10 MB",
              index_size: "2 MB",
              total_size: "12 MB",
              table_size_bytes: 10485760,
              index_size_bytes: 2097152,
              total_size_bytes: 12582912
            }
          ]
        };
      }
      return { rows: [] };
    };

    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);

    const result = await server.tools.pg_sizes_overview.execute({} as never);
    const parsed = JSON.parse(result);

    expect(parsed.database).toEqual({ database_name: "test_db", database_size: "100 MB", database_size_bytes: 104857600 });
    expect(parsed.schema).toBe("public");
    expect(parsed.tables).toHaveLength(1);
    expect(parsed.tables[0].table_name).toBe("users");
    expect(parsed.tables[0].total_size).toBe("12 MB");
  });

  it("pg_unused_indexes returns indexes with zero scans", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("pg_stat_user_indexes");
      expect(params).toEqual(["public"]);
      return { rows: [{ schema_name: "public", table_name: "orders", index_name: "idx_orders_old", index_size: "5 MB", index_size_bytes: 5242880, times_used: 0 }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);
    const result = await server.tools.pg_unused_indexes.execute({} as never);
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.unused_indexes[0].index_name).toBe("idx_orders_old");
  });

  it("pg_duplicate_indexes returns redundant index candidates", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("pg_index");
      expect(params).toEqual(["public"]);
      return { rows: [{ table_name: "users", duplicate_index: "idx_users_email", covered_by_index: "idx_users_email_name", duplicate_columns: "email", wasted_size: "2 MB", wasted_size_bytes: 2097152 }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);
    const result = await server.tools.pg_duplicate_indexes.execute({} as never);
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.duplicate_indexes[0].duplicate_index).toBe("idx_users_email");
  });

  it("pg_long_running_queries returns queries exceeding duration threshold", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("pg_stat_activity");
      // default value is applied by Zod .parse(), raw execute receives undefined — tool falls back to 30
      expect(typeof params[0] === "number" || params[0] === undefined).toBe(true);
      return { rows: [{ pid: 1234, username: "app", database: "mydb", state: "active", duration_seconds: 120, query_preview: "SELECT * FROM big_table" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);
    const result = await server.tools.pg_long_running_queries.execute({} as never);
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.long_running_queries[0].pid).toBe(1234);
    expect(parsed.long_running_queries[0].duration_seconds).toBe(120);
  });

  it("pg_missing_indexes returns tables with high seq scan counts", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("pg_stat_user_tables");
      expect(params[0]).toBe("public");
      return { rows: [{ schema_name: "public", table_name: "events", seq_scan: 5000, idx_scan: 200, seq_tup_read: 500000, estimated_row_count: 100000, index_hit_ratio_pct: "3.85" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);
    const result = await server.tools.pg_missing_indexes.execute({} as never);
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.tables[0].table_name).toBe("events");
    expect(parsed.tables[0].seq_scan).toBe(5000);
  });

  it("pg_bloat_estimate returns bloated tables above threshold", async () => {
    const query = async (sql: string, params: unknown[]) => {
      expect(sql).toContain("pg_stat_user_tables");
      expect(params[0]).toBe("public");
      return { rows: [{ schema_name: "public", table_name: "logs", live_rows: 80000, dead_rows: 20000, dead_ratio_pct: "20.00", last_vacuum: null, last_autovacuum: null, total_size: "150 MB" }] };
    };
    const server = new FakeServer();
    registerPostgresTools(server as never, makeFakeRegistry(true, { ok: true, client: { query } }) as never);
    const result = await server.tools.pg_bloat_estimate.execute({} as never);
    const parsed = JSON.parse(result);
    expect(parsed.count).toBe(1);
    expect(parsed.bloated_tables[0].table_name).toBe("logs");
    expect(parsed.bloated_tables[0].dead_ratio_pct).toBe("20.00");
  });
});

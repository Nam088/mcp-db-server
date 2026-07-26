# mcp-server-db

[![npm version](https://img.shields.io/npm/v/mcp-server-db.svg)](https://www.npmjs.com/package/mcp-server-db)
[![license](https://img.shields.io/npm/l/mcp-server-db.svg)](https://github.com/Nam088/mcp-database-server/blob/main/LICENSE)
[![node](https://img.shields.io/node/v/mcp-server-db.svg)](https://nodejs.org)
[![types](https://img.shields.io/npm/types/mcp-server-db.svg)](https://www.typescriptlang.org)

**mcp-server-db** is a universal, production-grade Model Context Protocol (MCP) server that empowers AI assistants to interact with **Postgres, Redis, Elasticsearch, MySQL, MongoDB, and LDAP** through a unified suite of **113+ high-performance tools**.

Built with resilience in mind, it features background lazy connection management, exponential backoff retries, circuit breaker patterns, strict read-only security enforcement, and on-demand dynamic driver loading.

---

## Why mcp-server-db?

- **Multi-Database Support**: Connect to Postgres, Redis, Elasticsearch (v7, v8 & v9), MySQL, MongoDB, and LDAP directories simultaneously.
- **On-Demand Light Drivers**: Zero bloat. Drivers (`pg`, `ioredis`, `mongodb`, `mysql2`, `@elastic/elasticsearch`, `ldapts`) are dynamically loaded only when a connection to that database engine is initialized.
- **Ironclad Safety**: Independent per-connection read-only mode with session-level enforcement for relational databases and query result truncation guards to prevent LLM context overflows.
- **Fault-Tolerant Architecture**: Server starts instantly regardless of database availability. Dead or unreachable databases fail gracefully without crashing the MCP process or blocking other connections.
- **Multi-Connection Routing**: Query multiple environments (e.g., production read-only replica + local scratch cache) in parallel within the same session.

---

## Supported Database Engines

| Database Engine | Default Driver | Supported Versions | Key Features & Guardrails |
| :--- | :--- | :--- | :--- |
| **PostgreSQL** | `pg` (optional) | 10+ | Table/Index stats, Health diagnostics, Session-level `read_only`, Statement timeouts |
| **Redis** | `ioredis` (optional) | 5+ | Key/String/Hash/Set/List operations, Automatic 1000-item result truncation cap |
| **Elasticsearch** | `@elastic/elasticsearch` / `es7-client` | 7.x, 8.x, 9.x | Dual-API version facade (v7 legacy & v8/v9 modern), Cluster health, Query DSL |
| **MySQL / MariaDB** | `mysql2` (optional) | 5.7+, 8.0+ | DDL extraction (`SHOW CREATE`), Processlist management, Indexes & Triggers, Session read-only |
| **MongoDB** | `mongodb` (optional) | 4.4+ | Aggregation pipelines, Distinct queries, Index management, Execution plan explain |
| **LDAP** | `ldapts` (optional) | v3 directories (OpenLDAP, AD, etc.) | Search/compare, Add/modify/delete entries, Bulk entry seeding |

---

## Quick Start

### 1. Installation & Optional Drivers

When installed globally (`npm install -g mcp-server-db`) or run via `npx -y mcp-server-db`, npm automatically includes all supported database drivers (`pg`, `ioredis`, `@elastic/elasticsearch`, `mysql2`, `mongodb`, `ldapts`) out of the box via `optionalDependencies`.

```bash
# Global installation (includes all drivers out of the box)
npm install -g mcp-server-db

# Local project installation
npm install mcp-server-db
```

If you install `mcp-server-db` locally using `--no-optional` to keep your `node_modules` lightweight, you can install only the specific drivers you need:

```bash
# PostgreSQL
npm install pg

# Redis
npm install ioredis

# Elasticsearch
npm install @elastic/elasticsearch   # For v8 & v9
npm install es7-client               # For v7 legacy

# MySQL / MariaDB
npm install mysql2

# MongoDB
npm install mongodb

# LDAP
npm install ldapts
```

### 2. Zero-Install Execution via NPX

Add `mcp-server-db` directly to your MCP client config file (e.g. Claude Desktop, Claude Code, Gemini CLI, Cursor):

```json
{
  "mcpServers": {
    "mcp-server-db": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-server-db"],
      "env": {
        "POSTGRES_URL": "postgresql://user:password@localhost:5432/mydb",
        "REDIS_URL": "redis://localhost:6379",
        "MONGODB_URL": "mongodb://localhost:27017",
        "LDAP_URL": "ldap://localhost:389",
        "LDAP_BIND_DN": "cn=admin,dc=example,dc=com",
        "LDAP_BIND_PASSWORD": "admin-password"
      }
    }
  }
}
```

### 3. Fast Setup with Environment Variables

Define connection strings in `env` to start immediately without a configuration file:

```bash
POSTGRES_URL=postgresql://user:password@localhost:5432/mydb
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200
MYSQL_URL=mysql://user:password@localhost:3306/mydb
MONGODB_URL=mongodb://localhost:27017
LDAP_URL=ldap://localhost:389
LDAP_BIND_DN=cn=admin,dc=example,dc=com
LDAP_BIND_PASSWORD=admin-password
POSTGRES_READ_ONLY=true
REDIS_READ_ONLY=true
MYSQL_READ_ONLY=true
MONGODB_READ_ONLY=true
LDAP_READ_ONLY=true
```

---

## Complete Tools Reference (113 Tools)

### System & Management Tools (2)

- `db_status`: Inspect connection states (idle, connecting, connected, retrying, failed, circuit_open), read-only mode, and error logs across all configured databases.
- `db_reload_config`: Hot-reload `databases.config.yml` from disk and reconcile connections dynamically without interrupting active queries.

### Postgres Tools (30)

- `pg_query`: Execute read-only SELECT queries (enforces single-statement extended query protocol).
- `pg_execute_sql`: Execute write SQL statements (INSERT, UPDATE, DELETE, DDL). Blocked in read-only mode.
- `pg_list_tables`: List tables in a target schema.
- `pg_describe_table`: Inspect column data types, ordinal position, and nullability.
- `pg_list_schemas`: List all database schemas.
- `pg_list_views`: List all views in a schema.
- `pg_list_indexes`: List indexes and index definitions for a table.
- `pg_list_triggers`: List triggers and action statements in a schema.
- `pg_table_stats`: Get total size, table size, index size, and estimated row count.
- `pg_list_constraints`: List primary keys, foreign keys, and check constraints.
- `pg_explain_query`: Inspect query execution plans with EXPLAIN.
- `pg_active_queries`: Retrieve running non-idle queries and durations from `pg_stat_activity`.
- `pg_list_functions`: List user-defined functions, arguments, and return types.
- `pg_list_sequences`: List sequence objects in a schema.
- `pg_database_info`: Get database name, current user, PostgreSQL version, and database size.
- `pg_kill_query`: Terminate a running backend process by PID. Blocked in read-only mode.
- `pg_vacuum_analyze`: Run VACUUM ANALYZE to update statistics and reclaim dead tuples. Blocked in read-only mode.
- `pg_list_materialized_views`: List materialized views in a schema.
- `pg_refresh_materialized_view`: Refresh a materialized view (supports CONCURRENTLY). Blocked in read-only mode.
- `pg_index_usage`: Inspect index scan counts and tuple fetch statistics.
- `pg_lock_info`: Retrieve active database locks and query durations.
- `pg_get_top_queries`: Get slow queries from `pg_stat_statements`.
- `pg_explain_hypothetical_index`: Simulate hypothetical index performance using `hypopg`.
- `pg_database_health`: Run health audit (connections utilization, buffer cache hit ratio, dead rows, replication lag).
- `pg_sizes_overview`: Breakdown storage sizes for database, tables, and indexes.
- `pg_unused_indexes`: Identify zero-scan candidate indexes to drop.
- `pg_duplicate_indexes`: Find overlapping or redundant indexes.
- `pg_long_running_queries`: Find queries exceeding a duration threshold.
- `pg_missing_indexes`: Identify high-sequential-scan tables needing indexes.
- `pg_bloat_estimate`: Estimate table bloat ratio based on dead tuple count.

### Redis Tools (27)

- `redis_get`: Get string value at key.
- `redis_set`: Set key value. Blocked in read-only mode.
- `redis_mset`: Set multiple key/value pairs in a single command (e.g. for seeding). Blocked in read-only mode.
- `redis_del`: Delete key. Blocked in read-only mode.
- `redis_keys`: List keys matching a glob pattern (capped at 1000 items).
- `redis_ttl`: Get remaining TTL in seconds.
- `redis_hget`: Get hash field value.
- `redis_hset`: Set hash field value. Blocked in read-only mode.
- `redis_hdel`: Delete hash fields. Blocked in read-only mode.
- `redis_hgetall`: Get all hash fields and values.
- `redis_hexists`: Check hash field existence.
- `redis_sadd`: Add member to set. Blocked in read-only mode.
- `redis_srem`: Remove member from set. Blocked in read-only mode.
- `redis_smembers`: List set members (capped at 1000 items).
- `redis_sismember`: Test set membership.
- `redis_lpush`: Prepend element to list. Blocked in read-only mode.
- `redis_rpush`: Append element to list. Blocked in read-only mode.
- `redis_lpop`: Remove and return first list element. Blocked in read-only mode.
- `redis_rpop`: Remove and return last list element. Blocked in read-only mode.
- `redis_lrange`: Get range of list elements (capped at 1000 items).
- `redis_llen`: Get list length.
- `redis_exists`: Check key existence.
- `redis_expire`: Set key expiration in seconds. Blocked in read-only mode.
- `redis_type`: Retrieve data type of key.
- `redis_incr`: Increment integer key. Blocked in read-only mode.
- `redis_decr`: Decrement integer key. Blocked in read-only mode.
- `redis_flushdb`: Clear current Redis database. Blocked in read-only mode.

### Elasticsearch Tools (11)

- `es_cluster_health`: Get status (green/yellow/red), node counts, and shard metrics.
- `es_list_indices`: List indices, doc counts, store size, and status.
- `es_index_stats`: Get detailed metrics for a specific index.
- `es_search`: Execute search using Query DSL.
- `es_count`: Count documents matching a query.
- `es_get_doc`: Fetch document by ID.
- `es_index_doc`: Index or overwrite document. Blocked in read-only mode.
- `es_bulk_index`: Index multiple documents into one index in a single `_bulk` request, with per-document success/failure reporting (e.g. for seeding). Blocked in read-only mode.
- `es_update_doc`: Partially update document fields. Blocked in read-only mode.
- `es_delete_doc`: Delete document by ID. Blocked in read-only mode.
- `es_delete_by_query`: Delete documents matching Query DSL. Blocked in read-only mode.

### MySQL Tools (18)

- `mysql_query`: Execute read-only SELECT/SHOW/EXPLAIN queries.
- `mysql_execute_sql`: Execute write SQL (INSERT, UPDATE, DELETE, DDL). Blocked in read-only mode.
- `mysql_list_databases`: List databases on server.
- `mysql_list_tables`: List tables in database.
- `mysql_list_views`: List views and security options.
- `mysql_describe_table`: Show column definitions and metadata.
- `mysql_show_create_table`: Extract raw `CREATE TABLE` DDL statement.
- `mysql_show_create_view`: Extract raw `CREATE VIEW` DDL statement.
- `mysql_list_indexes`: Show table indexes (`SHOW INDEX`).
- `mysql_list_triggers`: List database triggers.
- `mysql_list_routines`: List stored procedures and functions.
- `mysql_list_constraints`: List foreign keys and constraints.
- `mysql_table_stats`: Retrieve estimated rows, data length, and index size.
- `mysql_active_queries`: Retrieve running threads (`SHOW FULL PROCESSLIST`).
- `mysql_kill_query`: Kill running process by ID. Blocked in read-only mode.
- `mysql_explain_query`: Analyze query execution plan (`EXPLAIN`).
- `mysql_global_status`: Query server global status metrics.
- `mysql_analyze_table`: Run `ANALYZE TABLE` to refresh statistics. Blocked in read-only mode.

### MongoDB Tools (19)

- `mongo_list_databases`: List databases on MongoDB cluster.
- `mongo_list_collections`: List collections in database.
- `mongo_find`: Query documents with filter, projection, sort, limit, and skip.
- `mongo_distinct`: Get unique field values.
- `mongo_aggregate`: Execute MongoDB aggregation pipeline.
- `mongo_count_documents`: Count documents matching filter.
- `mongo_insert_one`: Insert single document. Blocked in read-only mode.
- `mongo_insert_many`: Insert array of documents. Blocked in read-only mode.
- `mongo_update_one`: Update single document matching filter. Blocked in read-only mode.
- `mongo_update_many`: Update multiple documents. Blocked in read-only mode.
- `mongo_delete_one`: Delete single document. Blocked in read-only mode.
- `mongo_delete_many`: Delete multiple documents. Blocked in read-only mode.
- `mongo_create_index`: Create collection index. Blocked in read-only mode.
- `mongo_drop_index`: Drop collection index by name. Blocked in read-only mode.
- `mongo_list_indexes`: List all collection indexes.
- `mongo_db_stats`: Get database storage statistics.
- `mongo_collection_stats`: Get storage, index size, and object count for collection.
- `mongo_explain`: Get query planner execution plan and index scan metrics.
- `mongo_server_status`: Get cluster memory, connection, and operation stats.

### LDAP Tools (6)

- `ldap_search`: Search a directory by base DN, filter, and scope (capped at 500 entries).
- `ldap_compare`: Compare an attribute/value pair against an entry.
- `ldap_add`: Create a new entry. Blocked in read-only mode.
- `ldap_add_bulk`: Create multiple entries in one call (e.g. for seeding), with per-entry success/failure reporting. Blocked in read-only mode.
- `ldap_modify`: Add, replace, or delete an attribute's values on an entry. Blocked in read-only mode.
- `ldap_delete`: Delete an entry. Blocked in read-only mode.

---

## Multi-Connection YAML Configuration

For complex setups with multiple named databases, create `config/databases.config.yml` (copy `config/databases.config.example.yml`):

```yaml
connections:
  - id: primary-pg
    type: postgres
    connectionString: ${POSTGRES_URL}
    defaultSchema: public
    statementTimeoutMs: 30000
    readOnly: true

  - id: app-cache
    type: redis
    connectionString: ${REDIS_URL}
    readOnly: false

  - id: search-logs
    type: elasticsearch
    connectionString: ${ELASTICSEARCH_URL}
    apiVersion: "9"
    readOnly: true

  - id: legacy-cluster
    type: elasticsearch
    connectionString: ${LEGACY_ELASTICSEARCH_URL}
    apiVersion: "7"
    readOnly: true

  - id: analytics-mysql
    type: mysql
    connectionString: ${MYSQL_URL}
    statementTimeoutMs: 30000
    readOnly: true

  - id: document-store
    type: mongodb
    connectionString: ${MONGODB_URL}
    defaultDatabase: production
    readOnly: true

  - id: directory
    type: ldap
    connectionString: ${LDAP_URL}
    bindDn: ${LDAP_BIND_DN}
    bindPassword: ${LDAP_BIND_PASSWORD}
    readOnly: false
```

---

## Local Development & Custom Builds

### 1. Build and Run Locally

```bash
git clone https://github.com/Nam088/mcp-database-server.git
cd mcp-database-server
npm install
npm run build    # Compiles TypeScript to dist/
npm test         # Runs Vitest test suite
```

### 2. Configure Local Build in MCP Clients

```json
{
  "mcpServers": {
    "mcp-server-db": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/mcp-database-server/dist/index.js"],
      "env": {
        "DATABASES_CONFIG_PATH": "/absolute/path/to/mcp-database-server/config/databases.config.yml"
      }
    }
  }
}
```

### 3. Claude Code CLI

```bash
claude mcp add --scope user mcp-server-db node /absolute/path/to/mcp-database-server/dist/index.js --env DATABASES_CONFIG_PATH=/absolute/path/to/mcp-database-server/config/databases.config.yml
```

### Client Config Paths

- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Code (Global)**: `~/.claude.json`
- **Gemini CLI / IDE**: `~/.gemini/config/mcp_config.json`
- **Cursor / Project Root**: `.mcp.json`

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.

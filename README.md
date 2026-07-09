# mcp-database-server

MCP server exposing Postgres, Redis, and Elasticsearch as tools, supporting multiple named connections of each type at once. Connections are established lazily in the background: the server always starts and registers all tools immediately, even if every database is unreachable. Each connection retries with exponential backoff and opens a circuit breaker after repeated failures, so a dead database never gets hammered and never crashes the process.

## Tools

- `db_status` — state of every configured connection (idle/connecting/connected/retrying/failed/circuit_open), its readOnly mode, last error, and next retry time.
- `db_reload_config` — reload the `databases.config.yml` file from disk and reconcile connections: unchanged entries are left running, added/changed/removed entries are recreated or torn down.
- `pg_query`, `pg_execute_sql`, `pg_list_tables`, `pg_describe_table`, and 15+ more Postgres utility tools. They accept an optional `schema` and `connectionId`.
- `redis_get`, `redis_set`, `redis_del`, and 20+ more Redis utility tools. They accept an optional `connectionId`.
- `es_cluster_health`, `es_list_indices`, `es_index_stats`, `es_search`, `es_count`, `es_get_doc`, `es_index_doc`, `es_update_doc`, `es_delete_doc`, `es_delete_by_query` — Elasticsearch tools. They accept an optional `connectionId`.

## Per-connection read-only mode

Every connection has its own `readOnly` mode — there is no single global switch. Modifying operations check the *specific* connection they were asked to use and refuse to run if that connection's `readOnly` is `true` (the default). This lets you, for example, keep a production Postgres read-only while allowing writes to a scratch Redis cache, in the same server.

For Postgres, `readOnly` is also enforced by Postgres itself: a readOnly connection is opened with `default_transaction_read_only=on`, so a write can't sneak through a tool that's meant to be read-only (or through a raw SQL string containing more than one statement) even if the application-level check is bypassed.

## Configuration

Define any number of named connections in `config/databases.config.yml` (copy `config/databases.config.example.yml`):

```yaml
connections:
  - id: primary-pg
    type: postgres
    connectionString: ${POSTGRES_URL}
    defaultSchema: core # Optional default schema for Postgres connections
    statementTimeoutMs: 30000 # Optional, defaults to 30000 (30s)
    readOnly: true
  - id: cache
    type: redis
    connectionString: ${REDIS_URL}
    readOnly: false
  - id: logs-es
    type: elasticsearch
    connectionString: ${ELASTICSEARCH_URL}
    readOnly: true
```

Redis tools that can return an unbounded amount of data (`redis_keys`, `redis_smembers`, `redis_lrange`) are capped at 1000 items; past that, the result is wrapped as `{ items, truncated: true, returned, total }` instead of a plain array.

Or, for a single connection of each type, skip the config file and use env vars:

```
POSTGRES_URL=postgresql://user:password@localhost:5432/mydb
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200
POSTGRES_READ_ONLY=true
REDIS_READ_ONLY=true
ELASTICSEARCH_READ_ONLY=true
POSTGRES_DEFAULT_SCHEMA=public
POSTGRES_STATEMENT_TIMEOUT_MS=30000
```

## Development

```bash
npm install
npm run dev      # run with tsx against src/
npm test         # vitest
npm run build    # tsc -> dist/
```

## MCP Client Configuration

Add the following config under `mcpServers` in your config file:

```json
{
  "mcpServers": {
    "mcp-database-server": {
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

**Config file locations:**
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude Code (global)**: `~/.claude.json`
- **Gemini CLI / IDE**: `~/.gemini/config/mcp_config.json`
- **Project-level**: `.mcp.json` in your project root

### Claude Code CLI

You can also add it globally via the Claude Code CLI:

```bash
claude mcp add --scope user mcp-database-server node /absolute/path/to/mcp-database-server/dist/index.js --env DATABASES_CONFIG_PATH=/absolute/path/to/mcp-database-server/config/databases.config.yml
```

---

> [!TIP]
> Run `pwd` inside the project folder to get the absolute path.
> `DATABASES_CONFIG_PATH` is optional — defaults to the `config/` folder inside the project.


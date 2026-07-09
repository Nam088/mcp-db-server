# mcp-database-server

MCP server exposing Postgres and Redis as tools, supporting multiple named connections of each type at once. Connections are established lazily in the background: the server always starts and registers all tools immediately, even if every database is unreachable. Each connection retries with exponential backoff and opens a circuit breaker after repeated failures, so a dead database never gets hammered and never crashes the process.

## Tools

- `db_status` — state of every configured connection (idle/connecting/connected/retrying/failed/circuit_open), its readOnly mode, last error, and next retry time.
- `pg_query`, `pg_execute_sql`, `pg_list_tables`, `pg_describe_table` — Postgres. Accept an optional `connectionId` when more than one Postgres connection is configured.
- `redis_get`, `redis_set`, `redis_del`, `redis_keys`, `redis_ttl` — Redis. Accept an optional `connectionId` when more than one Redis connection is configured.

## Per-connection read-only mode

Every connection has its own `readOnly` mode — there is no single global switch. `pg_execute_sql`, `redis_set`, and `redis_del` check the *specific* connection they were asked to use and refuse to run if that connection's `readOnly` is `true` (the default). This lets you, for example, keep a production Postgres read-only while allowing writes to a scratch Redis cache, in the same server.

## Configuration

Define any number of named connections in `config/databases.config.yml` (copy `config/databases.config.example.yml`):

```yaml
connections:
  - id: primary-pg
    type: postgres
    connectionString: ${POSTGRES_URL}
    readOnly: true
  - id: cache
    type: redis
    connectionString: ${REDIS_URL}
    readOnly: false
```

Or, for a single connection of each type, skip the config file and use env vars:

```
POSTGRES_URL=postgresql://user:password@localhost:5432/mydb
REDIS_URL=redis://localhost:6379
POSTGRES_READ_ONLY=true
REDIS_READ_ONLY=true
```

## Development

```bash
npm install
npm run dev      # run with tsx against src/
npm test         # vitest
npm run build    # tsc -> dist/
```

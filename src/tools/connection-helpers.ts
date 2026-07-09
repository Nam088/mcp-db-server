import { UserError } from "fastmcp";
import type { ConnectionStatus } from "../connections/types.js";
import type { PostgresConnection } from "../connections/postgres-connection.js";
import type { RedisConnection } from "../connections/redis-connection.js";
import type { ElasticsearchConnection } from "../connections/elasticsearch-connection.js";

type AnyConnection = PostgresConnection | RedisConnection | ElasticsearchConnection;

interface RegistryLike {
  get(id: string): AnyConnection | undefined;
  findOneByType(type: string): AnyConnection | undefined;
  countByType(type: string): number;
}

export function resolveConnection(registry: RegistryLike, type: "postgres", connectionId?: string): PostgresConnection;
export function resolveConnection(registry: RegistryLike, type: "redis", connectionId?: string): RedisConnection;
export function resolveConnection(registry: RegistryLike, type: "elasticsearch", connectionId?: string): ElasticsearchConnection;
export function resolveConnection(
  registry: RegistryLike,
  type: "postgres" | "redis" | "elasticsearch",
  connectionId?: string,
): AnyConnection {
  const conn = connectionId ? registry.get(connectionId) : registry.findOneByType(type);

  if (!conn) {
    const count = registry.countByType(type);
    if (count === 0) {
      throw new UserError(`No ${type} connection configured.`);
    }
    throw new UserError(`Multiple ${type} connections configured; specify connectionId.`);
  }

  if (conn.type !== type) {
    throw new UserError(`Connection "${conn.id}" is type "${conn.type}", expected "${type}".`);
  }

  return conn;
}

/** Throws when the resolved connection's own readOnly mode blocks a write tool. */
export function requireWritable(conn: { id: string; readOnly: boolean }): void {
  if (conn.readOnly) {
    throw new UserError(
      `Connection "${conn.id}" is in READ_ONLY mode; write operations are blocked. Set readOnly: false for this connection to allow.`,
    );
  }
}

export function throwUnavailable(status: ConnectionStatus): never {
  throw new UserError(JSON.stringify({ error: "connection_unavailable", ...status }));
}

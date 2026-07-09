import { PostgresConnection } from "./postgres-connection.js";
import { RedisConnection } from "./redis-connection.js";
import type { DatabaseConfigEntry } from "../config/loader.js";
import type { ConnectionStatus } from "./types.js";

export type AnyConnection = PostgresConnection | RedisConnection;

export class ConnectionRegistry {
  private readonly connections = new Map<string, AnyConnection>();

  constructor(entries: DatabaseConfigEntry[]) {
    for (const entry of entries) {
      this.connections.set(entry.id, this.build(entry));
    }
  }

  private build(entry: DatabaseConfigEntry): AnyConnection {
    if (entry.type === "postgres") {
      return new PostgresConnection({ id: entry.id, connectionString: entry.connectionString, readOnly: entry.readOnly });
    }
    return new RedisConnection({ id: entry.id, connectionString: entry.connectionString, readOnly: entry.readOnly });
  }

  startAll(): void {
    for (const conn of this.connections.values()) conn.start();
  }

  get(id: string): AnyConnection | undefined {
    return this.connections.get(id);
  }

  findOneByType(type: string): AnyConnection | undefined {
    const matches = [...this.connections.values()].filter((c) => c.type === type);
    return matches.length === 1 ? matches[0] : undefined;
  }

  countByType(type: string): number {
    return [...this.connections.values()].filter((c) => c.type === type).length;
  }

  listStatuses(): ConnectionStatus[] {
    return [...this.connections.values()].map((c) => c.getStatus());
  }
}

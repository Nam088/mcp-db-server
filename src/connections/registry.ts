import { PostgresConnection } from "./postgres-connection.js";
import { RedisConnection } from "./redis-connection.js";
import { ElasticsearchConnection } from "./elasticsearch-connection.js";
import { loadDatabaseConfig, type DatabaseConfigEntry } from "../config/loader.js";
import type { ConnectionStatus } from "./types.js";

export type AnyConnection = PostgresConnection | RedisConnection | ElasticsearchConnection;

function entriesEqual(a: DatabaseConfigEntry, b: DatabaseConfigEntry): boolean {
  return (
    a.type === b.type &&
    a.connectionString === b.connectionString &&
    a.readOnly === b.readOnly &&
    a.defaultSchema === b.defaultSchema &&
    a.statementTimeoutMs === b.statementTimeoutMs
  );
}

export class ConnectionRegistry {
  private readonly connections = new Map<string, AnyConnection>();
  private readonly entriesById = new Map<string, DatabaseConfigEntry>();
  public readonly configPath?: string;
  private reloading = false;

  constructor(entries: DatabaseConfigEntry[], configPath?: string) {
    this.configPath = configPath;
    for (const entry of entries) {
      this.connections.set(entry.id, this.build(entry));
      this.entriesById.set(entry.id, entry);
    }
  }

  private build(entry: DatabaseConfigEntry): AnyConnection {
    if (entry.type === "postgres") {
      return new PostgresConnection({
        id: entry.id,
        connectionString: entry.connectionString,
        readOnly: entry.readOnly,
        defaultSchema: entry.defaultSchema,
        statementTimeoutMs: entry.statementTimeoutMs,
      });
    }
    if (entry.type === "elasticsearch") {
      return new ElasticsearchConnection({
        id: entry.id,
        connectionString: entry.connectionString,
        readOnly: entry.readOnly,
      });
    }
    return new RedisConnection({ id: entry.id, connectionString: entry.connectionString, readOnly: entry.readOnly });
  }

  startAll(): void {
    for (const conn of this.connections.values()) conn.start();
  }

  /**
   * Re-reads the config file and reconciles connections against it: unchanged entries
   * are left running untouched (so in-flight queries against them are not disrupted),
   * only added/changed/removed entries are stopped, rebuilt, or dropped.
   */
  async reload(): Promise<void> {
    if (!this.configPath) {
      throw new Error("No configPath was provided when ConnectionRegistry was initialized.");
    }
    if (this.reloading) {
      throw new Error("A config reload is already in progress; try again shortly.");
    }
    this.reloading = true;
    try {
      const entries = loadDatabaseConfig(this.configPath);
      const nextIds = new Set(entries.map((entry) => entry.id));

      for (const entry of entries) {
        const prevEntry = this.entriesById.get(entry.id);
        if (prevEntry && entriesEqual(prevEntry, entry)) {
          continue;
        }
        const existing = this.connections.get(entry.id);
        if (existing) {
          await existing.stop();
        }
        this.connections.set(entry.id, this.build(entry));
        this.entriesById.set(entry.id, entry);
        this.connections.get(entry.id)!.start();
      }

      for (const id of [...this.connections.keys()]) {
        if (!nextIds.has(id)) {
          await this.connections.get(id)!.stop();
          this.connections.delete(id);
          this.entriesById.delete(id);
        }
      }
    } finally {
      this.reloading = false;
    }
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

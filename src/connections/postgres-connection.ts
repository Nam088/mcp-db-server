import type { Pool } from "pg";
import { BaseConnection, type BaseConnectionOptions } from "./base-connection.js";

export interface PostgresConnectionOptions extends Omit<BaseConnectionOptions, "type"> {
  connectionString: string;
  defaultSchema?: string;
  statementTimeoutMs?: number;
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

export class PostgresConnection extends BaseConnection<Pool> {
  private readonly connectionString: string;
  public readonly defaultSchema: string;
  public readonly statementTimeoutMs: number;

  constructor(options: PostgresConnectionOptions) {
    super({ ...options, type: "postgres" });
    this.connectionString = options.connectionString;
    this.defaultSchema = options.defaultSchema ?? "public";
    this.statementTimeoutMs = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  }

  protected async attemptConnect(): Promise<Pool> {
    let pgModule;
    try {
      pgModule = await import("pg");
    } catch {
      throw new Error("Postgres driver 'pg' is not installed. Please run 'npm install pg'.");
    }

    const pg = pgModule.default ?? pgModule;
    const Pool = pg.Pool ?? pgModule.Pool;

    const sessionOptions = [
      `-c statement_timeout=${this.statementTimeoutMs}`,
      ...(this.readOnly ? ["-c default_transaction_read_only=on"] : []),
    ].join(" ");
    const pool = new Pool({
      connectionString: this.connectionString,
      options: sessionOptions,
    });
    pool.on("error", (err: Error) => {
      this.onFatalError(err);
    });
    await pool.query("SELECT 1");
    return pool;
  }

  protected async pingClient(pool: Pool): Promise<void> {
    await pool.query("SELECT 1");
  }

  protected async closeClient(pool: Pool): Promise<void> {
    await pool.end();
  }
}

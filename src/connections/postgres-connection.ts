import { Pool } from "pg";
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
    // Set via the startup packet ("-c") so it's applied by Postgres itself to every
    // physical connection the pool opens, with no race between connecting and a tool
    // call reusing that connection. default_transaction_read_only is Postgres's own
    // guardrail: a readOnly connection can't be made to write no matter which tool
    // (or raw SQL string) is used against it. statement_timeout caps a runaway query
    // so it can't hold a pool connection (and, on a small pool, the whole server) hostage.
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

  protected async closeClient(pool: Pool): Promise<void> {
    await pool.end();
  }
}

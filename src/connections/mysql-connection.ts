import type { Pool } from "mysql2/promise";
import { BaseConnection, type BaseConnectionOptions } from "./base-connection.js";

export interface MySqlConnectionOptions extends Omit<BaseConnectionOptions, "type"> {
  connectionString: string;
  statementTimeoutMs?: number;
}

const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

export class MySqlConnection extends BaseConnection<Pool> {
  private readonly connectionString: string;
  public readonly statementTimeoutMs: number;

  constructor(options: MySqlConnectionOptions) {
    super({ ...options, type: "mysql" });
    this.connectionString = options.connectionString;
    this.statementTimeoutMs = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  }

  protected async attemptConnect(): Promise<Pool> {
    let mysqlModule;
    try {
      mysqlModule = await import("mysql2/promise");
    } catch {
      throw new Error("MySQL driver 'mysql2' is not installed. Please run 'npm install mysql2'.");
    }
    const mysql = mysqlModule.default ?? mysqlModule;

    const pool = mysql.createPool(this.connectionString);
    const conn = await pool.getConnection();
    try {
      await conn.ping();
      if (this.readOnly) {
        try {
          await conn.query("SET SESSION TRANSACTION READ ONLY");
        } catch {
          // Ignore if server version doesn't support session transaction read only
        }
      }
    } finally {
      conn.release();
    }
    return pool;
  }

  protected async pingClient(pool: Pool): Promise<void> {
    const conn = await pool.getConnection();
    try {
      await conn.ping();
    } finally {
      conn.release();
    }
  }

  protected async closeClient(pool: Pool): Promise<void> {
    await pool.end();
  }
}

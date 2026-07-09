import { Pool } from "pg";
import { BaseConnection, type BaseConnectionOptions } from "./base-connection.js";

export interface PostgresConnectionOptions extends Omit<BaseConnectionOptions, "type"> {
  connectionString: string;
}

export class PostgresConnection extends BaseConnection<Pool> {
  private readonly connectionString: string;

  constructor(options: PostgresConnectionOptions) {
    super({ ...options, type: "postgres" });
    this.connectionString = options.connectionString;
  }

  protected async attemptConnect(): Promise<Pool> {
    const pool = new Pool({ connectionString: this.connectionString });
    pool.on("error", (err: Error) => {
      this.onFatalError(err);
    });
    await pool.query("SELECT 1");
    return pool;
  }
}

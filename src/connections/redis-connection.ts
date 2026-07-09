import { Redis } from "ioredis";
import { BaseConnection, type BaseConnectionOptions } from "./base-connection.js";

export interface RedisConnectionOptions extends Omit<BaseConnectionOptions, "type"> {
  connectionString: string;
}

export class RedisConnection extends BaseConnection<Redis> {
  private readonly connectionString: string;

  constructor(options: RedisConnectionOptions) {
    super({ ...options, type: "redis" });
    this.connectionString = options.connectionString;
  }

  protected async attemptConnect(): Promise<Redis> {
    // lazyConnect: we drive connect() ourselves below.
    // retryStrategy disabled: BaseConnection owns retry/backoff, avoiding two competing retry loops.
    const client = new Redis(this.connectionString, {
      lazyConnect: true,
      retryStrategy: () => null,
    });
    client.on("error", (err: Error) => {
      this.onFatalError(err);
    });
    await client.connect();
    await client.ping();
    return client;
  }

  protected async closeClient(client: Redis): Promise<void> {
    await client.quit();
  }
}

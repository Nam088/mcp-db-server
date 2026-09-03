import type { Redis } from "ioredis";
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
    let redisModule: any;
    try {
      redisModule = await import("ioredis");
    } catch {
      throw new Error("Redis driver 'ioredis' is not installed. Please run 'npm install ioredis'.");
    }

    const RedisConstructor = redisModule.default ?? redisModule.Redis ?? redisModule;

    // lazyConnect: we drive connect() ourselves below.
    // retryStrategy disabled: BaseConnection owns retry/backoff, avoiding two competing retry loops.
    const client = new RedisConstructor(this.connectionString, {
      lazyConnect: true,
      retryStrategy: () => null,
      tls: this.connectionString.startsWith("rediss://")
        ? { rejectUnauthorized: false }
        : undefined,
    });
    client.on("error", (err: Error) => {
      this.onFatalError(err);
    });
    await client.connect();
    await client.ping();
    return client;
  }

  protected async pingClient(client: Redis): Promise<void> {
    const res = await client.ping();
    if (res !== "PONG") {
      throw new Error(`Unexpected Redis ping response: ${res}`);
    }
  }

  protected async closeClient(client: Redis): Promise<void> {
    await client.quit();
  }
}

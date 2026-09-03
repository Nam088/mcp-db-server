import type { MongoClient } from "mongodb";
import { BaseConnection, type BaseConnectionOptions } from "./base-connection.js";

export interface MongoDbConnectionOptions extends Omit<BaseConnectionOptions, "type"> {
  connectionString: string;
  defaultDatabase?: string;
}

export class MongoDbConnection extends BaseConnection<MongoClient> {
  private readonly connectionString: string;
  public readonly defaultDatabase?: string;

  constructor(options: MongoDbConnectionOptions) {
    super({ ...options, type: "mongodb" });
    this.connectionString = options.connectionString;
    this.defaultDatabase = options.defaultDatabase;
  }

  protected async attemptConnect(): Promise<MongoClient> {
    let mongoModule;
    try {
      mongoModule = await import("mongodb");
    } catch {
      throw new Error("MongoDB driver 'mongodb' is not installed. Please run 'npm install mongodb'.");
    }
    const { MongoClient } = mongoModule;

    const client = new MongoClient(this.connectionString);
    await client.connect();
    await client.db(this.defaultDatabase).admin().ping();
    return client;
  }

  protected async pingClient(client: MongoClient): Promise<void> {
    await client.db(this.defaultDatabase).admin().ping();
  }

  protected async closeClient(client: MongoClient): Promise<void> {
    await client.close();
  }
}

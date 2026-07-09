import { Client } from "@elastic/elasticsearch";
import { BaseConnection, type BaseConnectionOptions } from "./base-connection.js";

export interface ElasticsearchConnectionOptions extends Omit<BaseConnectionOptions, "type"> {
  connectionString: string;
}

export class ElasticsearchConnection extends BaseConnection<Client> {
  private readonly connectionString: string;

  constructor(options: ElasticsearchConnectionOptions) {
    super({ ...options, type: "elasticsearch" });
    this.connectionString = options.connectionString;
  }

  protected async attemptConnect(): Promise<Client> {
    const client = new Client({ node: this.connectionString });
    await client.ping();
    return client;
  }

  protected async closeClient(client: Client): Promise<void> {
    await client.close();
  }
}

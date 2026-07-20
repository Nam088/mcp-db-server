import { BaseConnection, type BaseConnectionOptions } from "./base-connection.js";

export type ElasticsearchApiVersion = "7" | "8" | "9";

/**
 * Normalized facade over either client major version. v7 nests search/index/update/count/
 * deleteByQuery params under `body` and wraps every response in `{ body, statusCode, ... }`;
 * v9 takes flat params and resolves directly to the response body. Tools code is written
 * once against this shape and never has to know which major version is behind it.
 */
export interface ElasticsearchClient {
  ping(): Promise<unknown>;
  close(): Promise<void>;
  cluster: { health(): Promise<any> };
  cat: { indices(params: { format: "json" }): Promise<any> };
  indices: { stats(params: { index: string }): Promise<any> };
  search(params: { index: string; query?: unknown; size?: number }): Promise<any>;
  count(params: { index: string; query?: unknown }): Promise<any>;
  get(params: { index: string; id: string }): Promise<any>;
  index(params: { index: string; id?: string; document: unknown }): Promise<any>;
  update(params: { index: string; id: string; doc: unknown }): Promise<any>;
  delete(params: { index: string; id: string }): Promise<any>;
  deleteByQuery(params: { index: string; query: unknown }): Promise<any>;
}

function wrapV7Client(raw: any): ElasticsearchClient {
  const unwrap = (p: Promise<any>) => p.then((res) => res.body);
  return {
    ping: () => raw.ping(),
    close: () => Promise.resolve(raw.close()),
    cluster: { health: () => unwrap(raw.cluster.health()) },
    cat: { indices: (params) => unwrap(raw.cat.indices(params)) },
    indices: { stats: (params) => unwrap(raw.indices.stats(params)) },
    search: ({ index, query, size }) => unwrap(raw.search({ index, body: { query, size } })),
    count: ({ index, query }) => unwrap(raw.count({ index, body: query ? { query } : undefined })),
    get: (params) => unwrap(raw.get(params)),
    index: ({ index, id, document }) => unwrap(raw.index({ index, id, body: document })),
    update: ({ index, id, doc }) => unwrap(raw.update({ index, id, body: { doc } })),
    delete: (params) => unwrap(raw.delete(params)),
    deleteByQuery: ({ index, query }) => unwrap(raw.deleteByQuery({ index, body: { query } })),
  };
}

function wrapV9Client(raw: any): ElasticsearchClient {
  return {
    ping: () => raw.ping(),
    close: () => raw.close(),
    cluster: { health: () => raw.cluster.health() },
    cat: { indices: (params) => raw.cat.indices(params) },
    indices: { stats: (params) => raw.indices.stats(params) },
    search: (params) => raw.search(params),
    count: (params) => raw.count(params),
    get: (params) => raw.get(params),
    index: (params) => raw.index(params),
    update: (params) => raw.update(params),
    delete: (params) => raw.delete(params),
    deleteByQuery: (params) => raw.deleteByQuery(params),
  };
}

export interface ElasticsearchConnectionOptions extends Omit<BaseConnectionOptions, "type"> {
  connectionString: string;
  /** Major version of the target Elasticsearch server. Defaults to "9". */
  apiVersion?: ElasticsearchApiVersion;
}

export class ElasticsearchConnection extends BaseConnection<ElasticsearchClient> {
  private readonly connectionString: string;
  public readonly apiVersion: ElasticsearchApiVersion;

  constructor(options: ElasticsearchConnectionOptions) {
    super({ ...options, type: "elasticsearch" });
    this.connectionString = options.connectionString;
    this.apiVersion = options.apiVersion ?? "9";
  }

  protected async attemptConnect(): Promise<ElasticsearchClient> {
    if (this.apiVersion === "7") {
      let esV7Module: any;
      try {
        esV7Module = await import("es7-client");
      } catch {
        throw new Error("Elasticsearch v7 driver 'es7-client' is not installed. Please run 'npm install es7-client'.");
      }
      const ClientV7 = esV7Module.Client ?? esV7Module.default?.Client;
      const raw = new ClientV7({ node: this.connectionString });
      await raw.ping();
      return wrapV7Client(raw);
    }

    let esV9Module: any;
    try {
      esV9Module = await import("@elastic/elasticsearch");
    } catch {
      throw new Error(
        "Elasticsearch driver '@elastic/elasticsearch' is not installed. Please run 'npm install @elastic/elasticsearch'.",
      );
    }
    const ClientV9 = esV9Module.Client ?? esV9Module.default?.Client;
    const raw = new ClientV9({ node: this.connectionString });
    await raw.ping();
    return wrapV9Client(raw);
  }

  protected async closeClient(client: ElasticsearchClient): Promise<void> {
    await client.close();
  }
}

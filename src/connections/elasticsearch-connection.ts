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
  search(params: {
    index: string;
    query?: unknown;
    searchAfter?: unknown[];
    seqNoPrimaryTerm?: boolean;
    size?: number;
    sort?: unknown;
  }): Promise<any>;
  count(params: { index: string; query?: unknown }): Promise<any>;
  get(params: { index: string; id: string }): Promise<any>;
  index(params: { index: string; id?: string; document: unknown }): Promise<any>;
  update(params: { index: string; id: string; doc: unknown }): Promise<any>;
  delete(params: { index: string; id: string }): Promise<any>;
  deleteByQuery(params: { index: string; query: unknown }): Promise<any>;
  /** `operations` alternates action-metadata objects (e.g. `{ index: { _id? } }`) and their document bodies, per the ES bulk API. */
  bulk(params: { operations: unknown[] }): Promise<any>;
}

function wrapV7Client(raw: any): ElasticsearchClient {
  const unwrap = (p: Promise<any>) => p.then((res) => res.body);
  return {
    ping: () => raw.ping(),
    close: () => Promise.resolve(raw.close()),
    cluster: { health: () => unwrap(raw.cluster.health()) },
    cat: { indices: (params) => unwrap(raw.cat.indices(params)) },
    indices: { stats: (params) => unwrap(raw.indices.stats(params)) },
    search: ({ index, query, searchAfter, seqNoPrimaryTerm, size, sort }) =>
      unwrap(
        raw.search({
          index,
          body: { query, search_after: searchAfter, seq_no_primary_term: seqNoPrimaryTerm, size, sort },
        }),
      ),
    count: ({ index, query }) => unwrap(raw.count({ index, body: query ? { query } : undefined })),
    get: (params) => unwrap(raw.get(params)),
    index: ({ index, id, document }) => unwrap(raw.index({ index, id, body: document })),
    update: ({ index, id, doc }) => unwrap(raw.update({ index, id, body: { doc } })),
    delete: (params) => unwrap(raw.delete(params)),
    deleteByQuery: ({ index, query }) => unwrap(raw.deleteByQuery({ index, body: { query } })),
    bulk: ({ operations }) => unwrap(raw.bulk({ body: operations })),
  };
}

/**
 * The v7 driver (`es7-client`, itself `@elastic/elasticsearch@7.17.x`) refuses to talk to
 * any server that doesn't self-report as genuine Elasticsearch (checked via tagline/
 * build_flavor/`x-elastic-product` on the first non-root request). AWS OpenSearch Service
 * always fails that check, throwing `ProductNotSupportedError` on the very first real
 * request even though the wire protocol is otherwise ES-7-compatible. The check result is
 * cached on a private `Symbol('product check')` on `client.transport` — force it to `2`
 * ("checked-ok") up front so it's never actually run. Safe no-op against genuine
 * Elasticsearch 7.x too, since we already trust whatever `connectionString` the operator
 * configured.
 */
function disableV7ProductCheck(raw: any): void {
  const transport = raw?.transport;
  if (!transport) return;
  const productCheckSymbol = Object.getOwnPropertySymbols(transport).find(
    (symbol) => symbol.description === "product check",
  );
  if (productCheckSymbol) {
    transport[productCheckSymbol] = 2;
  }
}

function wrapV9Client(raw: any): ElasticsearchClient {
  return {
    ping: () => raw.ping(),
    close: () => raw.close(),
    cluster: { health: () => raw.cluster.health() },
    cat: { indices: (params) => raw.cat.indices(params) },
    indices: { stats: (params) => raw.indices.stats(params) },
    search: ({ index, query, searchAfter, seqNoPrimaryTerm, size, sort }) =>
      raw.search({ index, query, search_after: searchAfter, seq_no_primary_term: seqNoPrimaryTerm, size, sort }),
    count: (params) => raw.count(params),
    get: (params) => raw.get(params),
    index: (params) => raw.index(params),
    update: (params) => raw.update(params),
    delete: (params) => raw.delete(params),
    deleteByQuery: (params) => raw.deleteByQuery(params),
    bulk: (params) => raw.bulk(params),
  };
}

export interface ElasticsearchConnectionOptions extends Omit<BaseConnectionOptions, "type"> {
  connectionString: string;
  /** Major version of the target Elasticsearch server. Defaults to "9". */
  apiVersion?: ElasticsearchApiVersion;
  /**
   * Set to false to skip TLS certificate verification (e.g. an SSM-tunneled AWS
   * OpenSearch domain reached via `localhost`, whose cert only lists the real AWS
   * hostname as a SAN). Defaults to true.
   */
  rejectUnauthorized?: boolean;
}

export class ElasticsearchConnection extends BaseConnection<ElasticsearchClient> {
  private readonly connectionString: string;
  public readonly apiVersion: ElasticsearchApiVersion;
  private readonly rejectUnauthorized: boolean;

  constructor(options: ElasticsearchConnectionOptions) {
    super({ ...options, type: "elasticsearch" });
    this.connectionString = options.connectionString;
    this.apiVersion = options.apiVersion ?? "9";
    this.rejectUnauthorized = options.rejectUnauthorized ?? true;
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
      const raw = new ClientV7({
        node: this.connectionString,
        ssl: { rejectUnauthorized: this.rejectUnauthorized },
      });
      disableV7ProductCheck(raw);
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
    const raw = new ClientV9({
      node: this.connectionString,
      tls: { rejectUnauthorized: this.rejectUnauthorized },
    });
    await raw.ping();
    return wrapV9Client(raw);
  }

  protected async closeClient(client: ElasticsearchClient): Promise<void> {
    await client.close();
  }
}

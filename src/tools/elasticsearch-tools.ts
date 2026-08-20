import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { ConnectionRegistry } from "../connections/registry.js";
import { resolveConnection, requireWritable, throwUnavailable } from "./connection-helpers.js";

const connectionIdParam = z
  .string()
  .optional()
  .describe(
    "Id of the elasticsearch connection to use, from databases.config.yml. Optional when only one elasticsearch connection is configured.",
  );

const indexParam = z.string().describe("Index name.");

const queryParam = z
  .record(z.string(), z.any())
  .optional()
  .describe('Elasticsearch Query DSL object, e.g. { "match": { "title": "foo" } }. Defaults to match_all.');

export function registerElasticsearchTools(server: FastMCP, registry: ConnectionRegistry): void {
  server.addTool({
    name: "es_cluster_health",
    description: "Get Elasticsearch cluster health: status (green/yellow/red), node count, and shard counts.",
    parameters: z.object({ connectionId: connectionIdParam }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "elasticsearch", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const health = await result.client.cluster.health();
      return JSON.stringify(health);
    },
  });

  server.addTool({
    name: "es_list_indices",
    description: "List all indices with document count, size, and health status.",
    parameters: z.object({ connectionId: connectionIdParam }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "elasticsearch", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const indices = await result.client.cat.indices({ format: "json" });
      return JSON.stringify(indices);
    },
  });

  server.addTool({
    name: "es_index_stats",
    description: "Get stats (doc count, store size, segments) for a specific index.",
    parameters: z.object({ index: indexParam, connectionId: connectionIdParam }),
    execute: async ({ index, connectionId }) => {
      const conn = resolveConnection(registry, "elasticsearch", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const stats = await result.client.indices.stats({ index });
      return JSON.stringify(stats);
    },
  });

  server.addTool({
    name: "es_search",
    description:
      "Run a search query against an index using Elasticsearch Query DSL. Supports sort + search_after for paginating past the default 10k-result window (e.g. sort by _seq_no for a resumable, ingestion-order-safe cursor across multi-index or data-stream sources). Pass seqNoPrimaryTerm: true to have each hit include its _seq_no/_primary_term.",
    parameters: z.object({
      index: indexParam,
      query: queryParam,
      size: z.number().int().optional().default(10).describe("Maximum number of hits to return."),
      sort: z
        .array(z.record(z.string(), z.enum(["asc", "desc"])))
        .optional()
        .describe(
          'Sort clauses, e.g. [{"_seq_no": "asc"}] or [{"measured_date": "asc"}, {"_id": "asc"}]. Required for search_after to be meaningful — the sort values of the last hit are what you feed back in as searchAfter.',
        ),
      searchAfter: z
        .array(z.union([z.string(), z.number()]))
        .optional()
        .describe(
          "Resume point for pagination: the sort-tuple values from the last hit of a previous page (same order as `sort`). Omit for the first page.",
        ),
      seqNoPrimaryTerm: z
        .boolean()
        .optional()
        .describe("Set true to have each returned hit include its _seq_no and _primary_term fields."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ index, query, size, sort, searchAfter, seqNoPrimaryTerm, connectionId }) => {
      const conn = resolveConnection(registry, "elasticsearch", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const response = await result.client.search({
        index,
        query: query ?? { match_all: {} },
        searchAfter,
        seqNoPrimaryTerm,
        size,
        sort,
      });
      return JSON.stringify(response.hits);
    },
  });

  server.addTool({
    name: "es_count",
    description: "Count documents in an index matching a query (or all documents if no query is given).",
    parameters: z.object({ index: indexParam, query: queryParam, connectionId: connectionIdParam }),
    execute: async ({ index, query, connectionId }) => {
      const conn = resolveConnection(registry, "elasticsearch", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const response = await result.client.count({ index, query });
      return JSON.stringify(response);
    },
  });

  server.addTool({
    name: "es_get_doc",
    description: "Get a document by id from an index.",
    parameters: z.object({ index: indexParam, id: z.string(), connectionId: connectionIdParam }),
    execute: async ({ index, id, connectionId }) => {
      const conn = resolveConnection(registry, "elasticsearch", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const doc = await result.client.get({ index, id });
      return JSON.stringify(doc);
    },
  });

  server.addTool({
    name: "es_index_doc",
    description:
      "Index (create or overwrite) a document. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      index: indexParam,
      id: z.string().optional().describe("Document id. Auto-generated by Elasticsearch when omitted."),
      document: z.record(z.string(), z.any()).describe("Document body."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ index, id, document, connectionId }) => {
      const conn = resolveConnection(registry, "elasticsearch", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const response = await result.client.index({ index, id, document });
      return JSON.stringify(response);
    },
  });

  server.addTool({
    name: "es_bulk_index",
    description:
      "Index (create or overwrite) multiple documents into one index in a single request via the Elasticsearch _bulk API (e.g. for seeding test/sample data) — far more efficient than one es_index_doc call per document. Reports per-document success/failure rather than aborting the whole batch on one bad document. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      index: indexParam,
      documents: z
        .string()
        .describe(
          'JSON array of documents to index. Each item may include an "_id" key to set the document id explicitly (removed before indexing); otherwise Elasticsearch auto-generates one. E.g. \'[{"_id":"1","title":"foo"},{"title":"bar"}]\'',
        ),
      connectionId: connectionIdParam,
    }),
    execute: async ({ index, documents, connectionId }) => {
      const conn = resolveConnection(registry, "elasticsearch", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);

      const parsedDocs = JSON.parse(documents) as Array<Record<string, unknown> & { _id?: string }>;
      if (parsedDocs.length === 0) {
        return JSON.stringify({ total: 0, succeeded: 0, failed: 0, results: [] });
      }

      const operations: unknown[] = [];
      for (const doc of parsedDocs) {
        const { _id, ...rest } = doc;
        operations.push({ index: _id ? { _index: index, _id } : { _index: index } });
        operations.push(rest);
      }

      const response = await result.client.bulk({ operations });
      const items = (response.items ?? []) as Array<Record<string, { _id?: string; error?: unknown; status?: number }>>;
      const results = items.map((item) => {
        const action = item.index ?? Object.values(item)[0];
        const failed = Boolean(action?.error);
        return failed
          ? { id: action?._id, success: false, error: JSON.stringify(action?.error) }
          : { id: action?._id, success: true };
      });
      const succeeded = results.filter((r) => r.success).length;

      return JSON.stringify({
        total: results.length,
        succeeded,
        failed: results.length - succeeded,
        results,
      });
    },
  });

  server.addTool({
    name: "es_update_doc",
    description: "Partially update a document by id. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      index: indexParam,
      id: z.string(),
      doc: z.record(z.string(), z.any()).describe("Partial document fields to merge into the existing document."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ index, id, doc, connectionId }) => {
      const conn = resolveConnection(registry, "elasticsearch", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const response = await result.client.update({ index, id, doc });
      return JSON.stringify(response);
    },
  });

  server.addTool({
    name: "es_delete_doc",
    description: "Delete a document by id. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({ index: indexParam, id: z.string(), connectionId: connectionIdParam }),
    execute: async ({ index, id, connectionId }) => {
      const conn = resolveConnection(registry, "elasticsearch", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const response = await result.client.delete({ index, id });
      return JSON.stringify(response);
    },
  });

  server.addTool({
    name: "es_delete_by_query",
    description:
      "Delete all documents in an index matching a query. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      index: indexParam,
      query: z.record(z.string(), z.any()).describe("Elasticsearch Query DSL object matching documents to delete."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ index, query, connectionId }) => {
      const conn = resolveConnection(registry, "elasticsearch", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const response = await result.client.deleteByQuery({ index, query });
      return JSON.stringify(response);
    },
  });
}

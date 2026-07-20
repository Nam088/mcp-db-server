import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { ConnectionRegistry } from "../connections/registry.js";
import { resolveConnection, requireWritable, throwUnavailable } from "./connection-helpers.js";

const connectionIdParam = z
  .string()
  .optional()
  .describe("Id of the mongodb connection to use. Optional when only one mongodb connection is configured.");

function parseJsonOrRaw(input: string | undefined, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid JSON parameter provided: ${input}`);
  }
}

function parseJsonArray(input: string): unknown[] {
  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
    return parsed as unknown[];
  } catch (err) {
    throw new Error(`Invalid JSON array provided: ${input} (${(err as Error).message})`);
  }
}

export function registerMongoDbTools(server: FastMCP, registry: ConnectionRegistry): void {
  server.addTool({
    name: "mongo_list_databases",
    description: "List all databases in MongoDB.",
    parameters: z.object({
      connectionId: connectionIdParam,
    }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const adminDb = result.client.db().admin();
      const dbs = await adminDb.listDatabases();
      return JSON.stringify(dbs.databases);
    },
  });

  server.addTool({
    name: "mongo_list_collections",
    description: "List all collections in a MongoDB database.",
    parameters: z.object({
      database: z.string().optional().describe("Database name. Defaults to connection defaultDatabase."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const collections = await db.listCollections().toArray();
      return JSON.stringify(collections);
    },
  });

  server.addTool({
    name: "mongo_find",
    description: "Query documents from a MongoDB collection.",
    parameters: z.object({
      collection: z.string().describe("Collection name."),
      filter: z.string().optional().describe("JSON string filter query (e.g. '{\"status\":\"active\"}')."),
      projection: z.string().optional().describe("JSON string field projection (e.g. '{\"name\":1}')."),
      sort: z.string().optional().describe("JSON string sort specification (e.g. '{\"createdAt\":-1}')."),
      limit: z.number().optional().default(100).describe("Max documents to return (default 100)."),
      skip: z.number().optional().default(0).describe("Number of documents to skip."),
      database: z.string().optional().describe("Database name."),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, filter, projection, sort, limit, skip, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);

      const filterObj = parseJsonOrRaw(filter);
      const projObj = parseJsonOrRaw(projection, {});
      const sortObj = parseJsonOrRaw(sort, {});

      let cursor = coll.find(filterObj, { projection: Object.keys(projObj).length > 0 ? projObj : undefined });
      if (Object.keys(sortObj).length > 0) {
        cursor = cursor.sort(sortObj as any);
      }
      if (skip > 0) cursor = cursor.skip(skip);
      const docs = await cursor.limit(limit).toArray();
      return JSON.stringify(docs);
    },
  });

  server.addTool({
    name: "mongo_distinct",
    description: "Find distinct values for a specified field in a MongoDB collection.",
    parameters: z.object({
      collection: z.string(),
      field: z.string().describe("Field path to get distinct values for."),
      filter: z.string().optional().describe("JSON string filter query."),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, field, filter, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const filterObj = parseJsonOrRaw(filter);
      const values = await coll.distinct(field, filterObj);
      return JSON.stringify(values);
    },
  });

  server.addTool({
    name: "mongo_aggregate",
    description: "Run an aggregation pipeline on a MongoDB collection.",
    parameters: z.object({
      collection: z.string(),
      pipeline: z.string().describe("JSON string representing an array of pipeline stages."),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, pipeline, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);

      const pipelineArray = parseJsonArray(pipeline) as Document[];
      const docs = await coll.aggregate(pipelineArray as any).toArray();
      return JSON.stringify(docs);
    },
  });

  server.addTool({
    name: "mongo_count_documents",
    description: "Count documents matching a filter in a MongoDB collection.",
    parameters: z.object({
      collection: z.string(),
      filter: z.string().optional().describe("JSON string filter query."),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, filter, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const filterObj = parseJsonOrRaw(filter);
      const count = await coll.countDocuments(filterObj);
      return JSON.stringify({ count });
    },
  });

  server.addTool({
    name: "mongo_insert_one",
    description: "Insert a single document into a MongoDB collection. Blocked when readOnly mode is enabled.",
    parameters: z.object({
      collection: z.string(),
      document: z.string().describe("JSON string of the document to insert."),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, document, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const docObj = parseJsonOrRaw(document);
      const res = await coll.insertOne(docObj);
      return JSON.stringify(res);
    },
  });

  server.addTool({
    name: "mongo_insert_many",
    description: "Insert multiple documents into a MongoDB collection. Blocked when readOnly mode is enabled.",
    parameters: z.object({
      collection: z.string(),
      documents: z.string().describe("JSON string array of documents to insert."),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, documents, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const docsArray = parseJsonArray(documents) as Record<string, unknown>[];
      const res = await coll.insertMany(docsArray);
      return JSON.stringify(res);
    },
  });

  server.addTool({
    name: "mongo_update_one",
    description: "Update a single document matching filter in MongoDB. Blocked when readOnly mode is enabled.",
    parameters: z.object({
      collection: z.string(),
      filter: z.string().describe("JSON string filter."),
      update: z.string().describe("JSON string update document (e.g. '{\"$set\":{\"name\":\"new\"}}')."),
      upsert: z.boolean().optional().default(false),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, filter, update, upsert, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const filterObj = parseJsonOrRaw(filter);
      const updateObj = parseJsonOrRaw(update);
      const res = await coll.updateOne(filterObj, updateObj, { upsert });
      return JSON.stringify(res);
    },
  });

  server.addTool({
    name: "mongo_update_many",
    description: "Update multiple documents matching filter in MongoDB. Blocked when readOnly mode is enabled.",
    parameters: z.object({
      collection: z.string(),
      filter: z.string().describe("JSON string filter."),
      update: z.string().describe("JSON string update document."),
      upsert: z.boolean().optional().default(false),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, filter, update, upsert, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const filterObj = parseJsonOrRaw(filter);
      const updateObj = parseJsonOrRaw(update);
      const res = await coll.updateMany(filterObj, updateObj, { upsert });
      return JSON.stringify(res);
    },
  });

  server.addTool({
    name: "mongo_delete_one",
    description: "Delete a single document matching filter in MongoDB. Blocked when readOnly mode is enabled.",
    parameters: z.object({
      collection: z.string(),
      filter: z.string().describe("JSON string filter."),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, filter, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const filterObj = parseJsonOrRaw(filter);
      const res = await coll.deleteOne(filterObj);
      return JSON.stringify(res);
    },
  });

  server.addTool({
    name: "mongo_delete_many",
    description: "Delete multiple documents matching filter in MongoDB. Blocked when readOnly mode is enabled.",
    parameters: z.object({
      collection: z.string(),
      filter: z.string().describe("JSON string filter."),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, filter, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const filterObj = parseJsonOrRaw(filter);
      const res = await coll.deleteMany(filterObj);
      return JSON.stringify(res);
    },
  });

  server.addTool({
    name: "mongo_create_index",
    description: "Create an index on a MongoDB collection. Blocked when readOnly mode is enabled.",
    parameters: z.object({
      collection: z.string(),
      keys: z.string().describe("JSON string index keys specification (e.g. '{\"email\":1}')."),
      unique: z.boolean().optional().default(false),
      name: z.string().optional().describe("Optional custom index name."),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, keys, unique, name, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const keysObj = parseJsonOrRaw(keys);
      const res = await coll.createIndex(keysObj as any, { unique, name });
      return JSON.stringify({ success: true, indexName: res });
    },
  });

  server.addTool({
    name: "mongo_drop_index",
    description: "Drop an index by name on a MongoDB collection. Blocked when readOnly mode is enabled.",
    parameters: z.object({
      collection: z.string(),
      indexName: z.string().describe("The name of the index to drop."),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, indexName, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const res = await coll.dropIndex(indexName);
      return JSON.stringify(res);
    },
  });

  server.addTool({
    name: "mongo_list_indexes",
    description: "List all indexes on a MongoDB collection.",
    parameters: z.object({
      collection: z.string(),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const indexes = await coll.listIndexes().toArray();
      return JSON.stringify(indexes);
    },
  });

  server.addTool({
    name: "mongo_db_stats",
    description: "Get statistics for a MongoDB database.",
    parameters: z.object({
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const stats = await db.stats();
      return JSON.stringify(stats);
    },
  });

  server.addTool({
    name: "mongo_collection_stats",
    description: "Get detailed storage, index size, and document count statistics for a MongoDB collection.",
    parameters: z.object({
      collection: z.string(),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const stats = await db.command({ collStats: collection });
      return JSON.stringify(stats);
    },
  });

  server.addTool({
    name: "mongo_explain",
    description: "Get execution plan and index scan statistics for a MongoDB find query.",
    parameters: z.object({
      collection: z.string(),
      filter: z.string().optional().describe("JSON string filter query."),
      verbosity: z.string().optional().default("queryPlanner").describe("Explain verbosity: queryPlanner | executionStats | allPlansExecution."),
      database: z.string().optional(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ collection, filter, verbosity, database, connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const dbName = database ?? conn.defaultDatabase;
      const db = result.client.db(dbName);
      const coll = db.collection(collection);
      const filterObj = parseJsonOrRaw(filter);
      const explainResult = await coll.find(filterObj).explain(verbosity as any);
      return JSON.stringify(explainResult);
    },
  });

  server.addTool({
    name: "mongo_server_status",
    description: "Get MongoDB server status (connections, memory, uptime, operations).",
    parameters: z.object({
      connectionId: connectionIdParam,
    }),
    execute: async ({ connectionId }) => {
      const conn = resolveConnection(registry, "mongodb", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const adminDb = result.client.db().admin();
      const status = await adminDb.command({ serverStatus: 1 });
      return JSON.stringify(status);
    },
  });
}

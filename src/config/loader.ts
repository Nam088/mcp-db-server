import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";

export interface DatabaseConfigEntry {
  id: string;
  type: "postgres" | "redis" | "elasticsearch" | "mysql" | "mongodb" | "ldap";
  connectionString: string;
  readOnly: boolean;
  defaultSchema?: string;
  defaultDatabase?: string;
  statementTimeoutMs?: number;
  /** Elasticsearch only: major version of the target server. Defaults to "9" (supports 8.x and 9.x). */
  apiVersion?: "7" | "8" | "9";
  /** LDAP only: DN to bind as. Anonymous bind is used when omitted. */
  bindDn?: string;
  /** LDAP only: password for bindDn. */
  bindPassword?: string;
}

interface RawConnectionEntry {
  id: string;
  type: string;
  connectionString: string;
  readOnly?: boolean;
  defaultSchema?: string;
  defaultDatabase?: string;
  statementTimeoutMs?: number;
  apiVersion?: string;
  bindDn?: string;
  bindPassword?: string;
}

interface RawConfigFile {
  connections: RawConnectionEntry[];
}

function expandEnvVars(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => process.env[name] ?? "");
}

function assertKnownType(type: string): "postgres" | "redis" | "elasticsearch" | "mysql" | "mongodb" | "ldap" {
  if (
    type === "postgres" ||
    type === "redis" ||
    type === "elasticsearch" ||
    type === "mysql" ||
    type === "mongodb" ||
    type === "ldap"
  ) {
    return type;
  }
  throw new Error(`Unsupported database type in config: ${type}`);
}

function assertApiVersion(apiVersion: string | undefined): "7" | "8" | "9" | undefined {
  if (apiVersion === undefined) return undefined;
  if (apiVersion === "7" || apiVersion === "8" || apiVersion === "9") return apiVersion;
  throw new Error(`Unsupported elasticsearch apiVersion in config: ${apiVersion}`);
}

function envReadOnly(varName: string): boolean {
  const raw = process.env[varName];
  return raw === undefined || raw.toLowerCase() !== "false";
}

export function loadDatabaseConfig(configPath: string): DatabaseConfigEntry[] {
  if (existsSync(configPath)) {
    const raw = parse(readFileSync(configPath, "utf8")) as RawConfigFile;
    return raw.connections.map((entry) => ({
      id: entry.id,
      type: assertKnownType(entry.type),
      connectionString: expandEnvVars(entry.connectionString),
      readOnly: entry.readOnly ?? true,
      defaultSchema: entry.defaultSchema,
      defaultDatabase: entry.defaultDatabase,
      statementTimeoutMs: entry.statementTimeoutMs,
      apiVersion: assertApiVersion(entry.apiVersion),
      bindDn: entry.bindDn ? expandEnvVars(entry.bindDn) : undefined,
      bindPassword: entry.bindPassword ? expandEnvVars(entry.bindPassword) : undefined,
    }));
  }

  const entries: DatabaseConfigEntry[] = [];
  if (process.env.POSTGRES_URL) {
    entries.push({
      id: "postgres",
      type: "postgres",
      connectionString: process.env.POSTGRES_URL,
      readOnly: envReadOnly("POSTGRES_READ_ONLY"),
      defaultSchema: process.env.POSTGRES_DEFAULT_SCHEMA,
      statementTimeoutMs: process.env.POSTGRES_STATEMENT_TIMEOUT_MS
        ? Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS)
        : undefined,
    });
  }
  if (process.env.REDIS_URL) {
    entries.push({
      id: "redis",
      type: "redis",
      connectionString: process.env.REDIS_URL,
      readOnly: envReadOnly("REDIS_READ_ONLY"),
    });
  }
  if (process.env.ELASTICSEARCH_URL) {
    entries.push({
      id: "elasticsearch",
      type: "elasticsearch",
      connectionString: process.env.ELASTICSEARCH_URL,
      readOnly: envReadOnly("ELASTICSEARCH_READ_ONLY"),
      apiVersion: assertApiVersion(process.env.ELASTICSEARCH_API_VERSION),
    });
  }
  if (process.env.MYSQL_URL) {
    entries.push({
      id: "mysql",
      type: "mysql",
      connectionString: process.env.MYSQL_URL,
      readOnly: envReadOnly("MYSQL_READ_ONLY"),
      statementTimeoutMs: process.env.MYSQL_STATEMENT_TIMEOUT_MS
        ? Number(process.env.MYSQL_STATEMENT_TIMEOUT_MS)
        : undefined,
    });
  }
  if (process.env.MONGODB_URL) {
    entries.push({
      id: "mongodb",
      type: "mongodb",
      connectionString: process.env.MONGODB_URL,
      readOnly: envReadOnly("MONGODB_READ_ONLY"),
      defaultDatabase: process.env.MONGODB_DEFAULT_DATABASE,
    });
  }
  if (process.env.LDAP_URL) {
    entries.push({
      id: "ldap",
      type: "ldap",
      connectionString: process.env.LDAP_URL,
      readOnly: envReadOnly("LDAP_READ_ONLY"),
      bindDn: process.env.LDAP_BIND_DN,
      bindPassword: process.env.LDAP_BIND_PASSWORD,
    });
  }
  return entries;
}

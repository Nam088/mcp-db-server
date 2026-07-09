import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";

export interface DatabaseConfigEntry {
  id: string;
  type: "postgres" | "redis";
  connectionString: string;
  readOnly: boolean;
}

interface RawConnectionEntry {
  id: string;
  type: string;
  connectionString: string;
  readOnly?: boolean;
}

interface RawConfigFile {
  connections: RawConnectionEntry[];
}

function expandEnvVars(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => process.env[name] ?? "");
}

function assertKnownType(type: string): "postgres" | "redis" {
  if (type === "postgres" || type === "redis") return type;
  throw new Error(`Unsupported database type in config: ${type}`);
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
    }));
  }

  const entries: DatabaseConfigEntry[] = [];
  if (process.env.POSTGRES_URL) {
    entries.push({
      id: "postgres",
      type: "postgres",
      connectionString: process.env.POSTGRES_URL,
      readOnly: envReadOnly("POSTGRES_READ_ONLY"),
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
  return entries;
}

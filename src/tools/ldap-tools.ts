import { z } from "zod";
import type { FastMCP } from "fastmcp";
import type { ConnectionRegistry } from "../connections/registry.js";
import { resolveConnection, requireWritable, throwUnavailable } from "./connection-helpers.js";

const connectionIdParam = z
  .string()
  .optional()
  .describe("Id of the ldap connection to use, from databases.config.yml. Optional when only one ldap connection is configured.");

// A search against a broad base/filter can return a very large number of entries; cap
// what we return so one call can't ship a huge payload back to the caller (same
// motivation as redis_keys/redis_smembers's MAX_RESULT_ITEMS).
const MAX_SEARCH_ENTRIES = 500;

function withEntryCap(entries: unknown[]): string {
  if (entries.length <= MAX_SEARCH_ENTRIES) {
    return JSON.stringify(entries);
  }
  return JSON.stringify({
    entries: entries.slice(0, MAX_SEARCH_ENTRIES),
    truncated: true,
    returned: MAX_SEARCH_ENTRIES,
    total: entries.length,
  });
}

export function registerLdapTools(server: FastMCP, registry: ConnectionRegistry): void {
  server.addTool({
    name: "ldap_search",
    description:
      "Search an LDAP directory. Returns matching entries (capped at 500; result is truncated=true with a total count if there are more).",
    parameters: z.object({
      baseDn: z.string().describe("Base DN to search from, e.g. 'ou=Users,dc=example,dc=com'"),
      filter: z.string().optional().describe("RFC4515 search filter, e.g. '(&(objectClass=person)(uid=jdoe))'. Defaults to '(objectclass=*)'"),
      scope: z.enum(["base", "one", "sub", "children", "subordinates"]).optional().describe("Search scope. Defaults to 'sub'"),
      attributes: z.array(z.string()).optional().describe("Attributes to return. Omit to return all attributes"),
      sizeLimit: z.number().int().positive().optional().describe("Maximum entries the server should return (0/omitted = server default)"),
      connectionId: connectionIdParam,
    }),
    execute: async ({ baseDn, filter, scope, attributes, sizeLimit, connectionId }) => {
      const conn = resolveConnection(registry, "ldap", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const { searchEntries } = await result.client.search(baseDn, {
        filter,
        scope,
        attributes,
        sizeLimit,
      });
      return withEntryCap(searchEntries);
    },
  });

  server.addTool({
    name: "ldap_compare",
    description: "Compare an attribute/value pair against an LDAP entry. Returns true if they match.",
    parameters: z.object({
      dn: z.string().describe("DN of the entry to compare against"),
      attribute: z.string(),
      value: z.string(),
      connectionId: connectionIdParam,
    }),
    execute: async ({ dn, attribute, value, connectionId }) => {
      const conn = resolveConnection(registry, "ldap", connectionId);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const matches = await result.client.compare(dn, attribute, value);
      return String(matches);
    },
  });

  server.addTool({
    name: "ldap_add",
    description:
      "Create a new LDAP entry. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      dn: z.string().describe("DN of the new entry"),
      attributes: z
        .string()
        .describe('JSON object of attributes, e.g. \'{"objectClass":["inetOrgPerson"],"cn":["John Doe"],"sn":["Doe"]}\''),
      connectionId: connectionIdParam,
    }),
    execute: async ({ dn, attributes, connectionId }) => {
      const conn = resolveConnection(registry, "ldap", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      const parsed = JSON.parse(attributes) as Record<string, string[] | string>;
      await result.client.add(dn, parsed);
      return JSON.stringify({ success: true, dn });
    },
  });

  server.addTool({
    name: "ldap_add_bulk",
    description:
      "Create multiple LDAP entries in one call (e.g. for seeding test/sample data). LDAP has no native multi-entry add operation, so this adds each entry sequentially and reports per-entry success/failure rather than aborting on the first error — a bad entry never blocks the rest of the batch. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      entries: z
        .string()
        .describe(
          'JSON array of {dn, attributes} objects, e.g. \'[{"dn":"uid=jdoe,ou=Users,dc=example,dc=com","attributes":{"objectClass":["inetOrgPerson"],"cn":["John Doe"],"sn":["Doe"]}}]\'',
        ),
      connectionId: connectionIdParam,
    }),
    execute: async ({ entries, connectionId }) => {
      const conn = resolveConnection(registry, "ldap", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);

      const parsedEntries = JSON.parse(entries) as Array<{ dn: string; attributes: Record<string, string[] | string> }>;

      const results: Array<{ dn: string; success: boolean; error?: string }> = [];
      for (const entry of parsedEntries) {
        try {
          await result.client.add(entry.dn, entry.attributes);
          results.push({ dn: entry.dn, success: true });
        } catch (err) {
          results.push({ dn: entry.dn, success: false, error: err instanceof Error ? err.message : String(err) });
        }
      }

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
    name: "ldap_modify",
    description:
      "Add, replace, or delete a single attribute's values on an existing LDAP entry. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      dn: z.string().describe("DN of the entry to modify"),
      operation: z.enum(["add", "replace", "delete"]),
      attribute: z.string(),
      values: z.array(z.string()).optional().describe("New values for the attribute. Omit/empty for 'delete' to remove the whole attribute"),
      connectionId: connectionIdParam,
    }),
    execute: async ({ dn, operation, attribute, values, connectionId }) => {
      const conn = resolveConnection(registry, "ldap", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);

      let ldapModule;
      try {
        ldapModule = await import("ldapts");
      } catch {
        throw new Error("LDAP driver 'ldapts' is not installed. Please run 'npm install ldapts'.");
      }
      const change = new ldapModule.Change({
        operation,
        modification: new ldapModule.Attribute({ type: attribute, values: values ?? [] }),
      });
      await result.client.modify(dn, change);
      return JSON.stringify({ success: true, dn, operation, attribute });
    },
  });

  server.addTool({
    name: "ldap_delete",
    description: "Delete an LDAP entry. Blocked when that connection's own readOnly mode is enabled.",
    parameters: z.object({
      dn: z.string().describe("DN of the entry to delete"),
      connectionId: connectionIdParam,
    }),
    execute: async ({ dn, connectionId }) => {
      const conn = resolveConnection(registry, "ldap", connectionId);
      requireWritable(conn);
      const result = await conn.getClient();
      if (!result.ok) throwUnavailable(result.status);
      await result.client.del(dn);
      return JSON.stringify({ success: true, dn });
    },
  });
}

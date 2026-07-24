import { describe, it, expect, vi } from "vitest";

vi.mock("ldapts", async () => {
  const actual = await vi.importActual<typeof import("ldapts")>("ldapts");
  return actual;
});

const { registerLdapTools } = await import("../../src/tools/ldap-tools.js");

class FakeServer {
  public tools: Record<string, { execute: (args: any) => Promise<string> }> = {};
  addTool(def: { name: string; execute: (args: any) => Promise<string> }): void {
    this.tools[def.name] = def;
  }
}

describe("ldap tools", () => {
  it("ldap_search returns matching entries when connected", async () => {
    const fakeServer = new FakeServer();
    const searchMock = vi.fn().mockResolvedValue({
      searchEntries: [{ dn: "uid=jdoe,ou=Users,dc=example,dc=com", cn: "John Doe" }],
      searchReferences: [],
    });

    const mockConn = {
      id: "ldap1",
      type: "ldap",
      readOnly: true,
      getClient: async () => ({ ok: true, client: { search: searchMock } }),
    };

    const fakeRegistry = {
      get: (id: string) => mockConn,
      findOneByType: () => mockConn,
      countByType: () => 1,
    };

    registerLdapTools(fakeServer as never, fakeRegistry as never);

    const res = await fakeServer.tools.ldap_search.execute({
      baseDn: "ou=Users,dc=example,dc=com",
      filter: "(uid=jdoe)",
    });

    expect(JSON.parse(res)).toEqual([{ dn: "uid=jdoe,ou=Users,dc=example,dc=com", cn: "John Doe" }]);
    expect(searchMock).toHaveBeenCalledWith("ou=Users,dc=example,dc=com", {
      filter: "(uid=jdoe)",
      scope: undefined,
      attributes: undefined,
      sizeLimit: undefined,
    });
  });

  it("ldap_search caps results at 500 entries and reports truncation", async () => {
    const fakeServer = new FakeServer();
    const manyEntries = Array.from({ length: 600 }, (_, i) => ({ dn: `uid=user${i},dc=example,dc=com` }));
    const searchMock = vi.fn().mockResolvedValue({ searchEntries: manyEntries, searchReferences: [] });

    const mockConn = {
      id: "ldap1",
      type: "ldap",
      readOnly: true,
      getClient: async () => ({ ok: true, client: { search: searchMock } }),
    };
    const fakeRegistry = { get: () => mockConn, findOneByType: () => mockConn, countByType: () => 1 };

    registerLdapTools(fakeServer as never, fakeRegistry as never);

    const res = await fakeServer.tools.ldap_search.execute({ baseDn: "dc=example,dc=com" });
    const parsed = JSON.parse(res);
    expect(parsed.truncated).toBe(true);
    expect(parsed.returned).toBe(500);
    expect(parsed.total).toBe(600);
    expect(parsed.entries).toHaveLength(500);
  });

  it("ldap_compare returns the match result", async () => {
    const fakeServer = new FakeServer();
    const compareMock = vi.fn().mockResolvedValue(true);
    const mockConn = {
      id: "ldap1",
      type: "ldap",
      readOnly: true,
      getClient: async () => ({ ok: true, client: { compare: compareMock } }),
    };
    const fakeRegistry = { get: () => mockConn, findOneByType: () => mockConn, countByType: () => 1 };

    registerLdapTools(fakeServer as never, fakeRegistry as never);

    const res = await fakeServer.tools.ldap_compare.execute({
      dn: "uid=jdoe,dc=example,dc=com",
      attribute: "cn",
      value: "John Doe",
    });
    expect(res).toBe("true");
  });

  it("ldap_add blocks write when readOnly is true", async () => {
    const fakeServer = new FakeServer();
    const mockConn = {
      id: "ldap1",
      type: "ldap",
      readOnly: true,
      getClient: async () => ({ ok: true, client: {} }),
    };
    const fakeRegistry = { get: () => mockConn, findOneByType: () => mockConn, countByType: () => 1 };

    registerLdapTools(fakeServer as never, fakeRegistry as never);

    await expect(
      fakeServer.tools.ldap_add.execute({
        dn: "uid=jdoe,dc=example,dc=com",
        attributes: '{"objectClass":["inetOrgPerson"],"cn":["John Doe"]}',
      }),
    ).rejects.toThrow("READ_ONLY mode");
  });

  it("ldap_add creates an entry when writable", async () => {
    const fakeServer = new FakeServer();
    const addMock = vi.fn().mockResolvedValue(undefined);
    const mockConn = {
      id: "ldap1",
      type: "ldap",
      readOnly: false,
      getClient: async () => ({ ok: true, client: { add: addMock } }),
    };
    const fakeRegistry = { get: () => mockConn, findOneByType: () => mockConn, countByType: () => 1 };

    registerLdapTools(fakeServer as never, fakeRegistry as never);

    const res = await fakeServer.tools.ldap_add.execute({
      dn: "uid=jdoe,dc=example,dc=com",
      attributes: '{"objectClass":["inetOrgPerson"],"cn":["John Doe"]}',
    });

    expect(JSON.parse(res)).toEqual({ success: true, dn: "uid=jdoe,dc=example,dc=com" });
    expect(addMock).toHaveBeenCalledWith("uid=jdoe,dc=example,dc=com", {
      objectClass: ["inetOrgPerson"],
      cn: ["John Doe"],
    });
  });

  it("ldap_add_bulk adds each entry and reports per-entry success/failure without aborting on the first error", async () => {
    const fakeServer = new FakeServer();
    const addMock = vi.fn().mockImplementation(async (dn: string) => {
      if (dn === "uid=bad,dc=example,dc=com") {
        throw new Error("already exists");
      }
    });
    const mockConn = {
      id: "ldap1",
      type: "ldap",
      readOnly: false,
      getClient: async () => ({ ok: true, client: { add: addMock } }),
    };
    const fakeRegistry = { get: () => mockConn, findOneByType: () => mockConn, countByType: () => 1 };

    registerLdapTools(fakeServer as never, fakeRegistry as never);

    const entries = JSON.stringify([
      { dn: "uid=good1,dc=example,dc=com", attributes: { objectClass: ["inetOrgPerson"], cn: ["Good One"] } },
      { dn: "uid=bad,dc=example,dc=com", attributes: { objectClass: ["inetOrgPerson"], cn: ["Bad"] } },
      { dn: "uid=good2,dc=example,dc=com", attributes: { objectClass: ["inetOrgPerson"], cn: ["Good Two"] } },
    ]);

    const res = await fakeServer.tools.ldap_add_bulk.execute({ entries });
    const parsed = JSON.parse(res);

    expect(addMock).toHaveBeenCalledTimes(3);
    expect(parsed.total).toBe(3);
    expect(parsed.succeeded).toBe(2);
    expect(parsed.failed).toBe(1);
    expect(parsed.results).toEqual([
      { dn: "uid=good1,dc=example,dc=com", success: true },
      { dn: "uid=bad,dc=example,dc=com", success: false, error: "already exists" },
      { dn: "uid=good2,dc=example,dc=com", success: true },
    ]);
  });

  it("ldap_add_bulk blocks write when readOnly is true", async () => {
    const fakeServer = new FakeServer();
    const mockConn = {
      id: "ldap1",
      type: "ldap",
      readOnly: true,
      getClient: async () => ({ ok: true, client: {} }),
    };
    const fakeRegistry = { get: () => mockConn, findOneByType: () => mockConn, countByType: () => 1 };

    registerLdapTools(fakeServer as never, fakeRegistry as never);

    await expect(fakeServer.tools.ldap_add_bulk.execute({ entries: "[]" })).rejects.toThrow("READ_ONLY mode");
  });

  it("ldap_modify applies a replace change with the given attribute/values", async () => {
    const fakeServer = new FakeServer();
    const modifyMock = vi.fn().mockResolvedValue(undefined);
    const mockConn = {
      id: "ldap1",
      type: "ldap",
      readOnly: false,
      getClient: async () => ({ ok: true, client: { modify: modifyMock } }),
    };
    const fakeRegistry = { get: () => mockConn, findOneByType: () => mockConn, countByType: () => 1 };

    registerLdapTools(fakeServer as never, fakeRegistry as never);

    const res = await fakeServer.tools.ldap_modify.execute({
      dn: "uid=jdoe,dc=example,dc=com",
      operation: "replace",
      attribute: "mail",
      values: ["jdoe@example.com"],
    });

    expect(JSON.parse(res)).toEqual({ success: true, dn: "uid=jdoe,dc=example,dc=com", operation: "replace", attribute: "mail" });
    expect(modifyMock).toHaveBeenCalledTimes(1);
    const [dn, change] = modifyMock.mock.calls[0];
    expect(dn).toBe("uid=jdoe,dc=example,dc=com");
    expect(change.operation).toBe("replace");
    expect(change.modification.type).toBe("mail");
    expect(change.modification.values).toEqual(["jdoe@example.com"]);
  });

  it("ldap_delete removes an entry when writable", async () => {
    const fakeServer = new FakeServer();
    const delMock = vi.fn().mockResolvedValue(undefined);
    const mockConn = {
      id: "ldap1",
      type: "ldap",
      readOnly: false,
      getClient: async () => ({ ok: true, client: { del: delMock } }),
    };
    const fakeRegistry = { get: () => mockConn, findOneByType: () => mockConn, countByType: () => 1 };

    registerLdapTools(fakeServer as never, fakeRegistry as never);

    const res = await fakeServer.tools.ldap_delete.execute({ dn: "uid=jdoe,dc=example,dc=com" });
    expect(JSON.parse(res)).toEqual({ success: true, dn: "uid=jdoe,dc=example,dc=com" });
    expect(delMock).toHaveBeenCalledWith("uid=jdoe,dc=example,dc=com");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

const bindMock = vi.fn();
const unbindMock = vi.fn();

vi.mock("ldapts", () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      bind: bindMock,
      unbind: unbindMock,
    })),
  };
});

const { LdapConnection } = await import("../../src/connections/ldap-connection.js");

const fastSleep = (_ms: number) => new Promise<void>((resolve) => setTimeout(resolve, 1));

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

describe("LdapConnection", () => {
  beforeEach(() => {
    bindMock.mockReset();
    unbindMock.mockReset();
  });

  it("connects successfully with an authenticated bind when bindDn/bindPassword are given", async () => {
    bindMock.mockResolvedValue(undefined);

    const conn = new LdapConnection({
      id: "ldap1",
      connectionString: "ldap://localhost:389",
      bindDn: "cn=admin,dc=example,dc=com",
      bindPassword: "secret",
      sleep: fastSleep,
    });
    conn.start();

    await waitUntil(() => conn.state === "connected");
    expect(bindMock).toHaveBeenCalledWith("cn=admin,dc=example,dc=com", "secret");
    expect((await conn.getClient()).ok).toBe(true);
    await conn.stop();
    expect(unbindMock).toHaveBeenCalled();
  });

  it("connects with an anonymous bind when bindDn is omitted", async () => {
    bindMock.mockResolvedValue(undefined);

    const conn = new LdapConnection({
      id: "ldap2",
      connectionString: "ldap://localhost:389",
      sleep: fastSleep,
    });
    conn.start();

    await waitUntil(() => conn.state === "connected");
    expect(bindMock).toHaveBeenCalledWith("", "");
    await conn.stop();
  });

  it("reports failed state when bind fails (e.g. invalid credentials)", async () => {
    bindMock.mockRejectedValue(new Error("invalid credentials"));

    const conn = new LdapConnection({
      id: "ldap3",
      connectionString: "ldap://localhost:389",
      bindDn: "cn=admin,dc=example,dc=com",
      bindPassword: "wrong",
      baseBackoffMs: 1,
      maxBackoffMs: 1,
      sleep: fastSleep,
    });
    conn.start();

    await waitUntil(() => conn.state === "failed" || conn.state === "retrying");
    const result = await conn.getClient();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status.lastError?.message).toBe("invalid credentials");
    await conn.stop();
  });

  it("stores readOnly option", () => {
    const conn = new LdapConnection({
      id: "ldap4",
      connectionString: "ldap://localhost:389",
      readOnly: true,
    });
    expect(conn.readOnly).toBe(true);
    expect(conn.type).toBe("ldap");
  });
});

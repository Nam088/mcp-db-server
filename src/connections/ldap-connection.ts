import type { Client } from "ldapts";
import { BaseConnection, type BaseConnectionOptions } from "./base-connection.js";

export interface LdapConnectionOptions extends Omit<BaseConnectionOptions, "type"> {
  /** LDAP URL (proto/host/port only), e.g. "ldap://localhost:389" or "ldaps://host:636". */
  connectionString: string;
  /** DN to bind as. Anonymous bind is used when omitted. */
  bindDn?: string;
  bindPassword?: string;
}

export class LdapConnection extends BaseConnection<Client> {
  private readonly url: string;
  private readonly bindDn?: string;
  private readonly bindPassword?: string;

  constructor(options: LdapConnectionOptions) {
    super({ ...options, type: "ldap" });
    this.url = options.connectionString;
    this.bindDn = options.bindDn;
    this.bindPassword = options.bindPassword;
  }

  protected async attemptConnect(): Promise<Client> {
    let ldapModule;
    try {
      ldapModule = await import("ldapts");
    } catch {
      throw new Error("LDAP driver 'ldapts' is not installed. Please run 'npm install ldapts'.");
    }
    const { Client: LdapClient } = ldapModule;

    const client = new LdapClient({ url: this.url });
    // ldapts connects lazily on the first operation, so a bind (real or anonymous) is the
    // actual connectivity check here — the equivalent of mongo's admin().ping() /
    // redis's ping(). Without this, an unreachable/misconfigured server would only fail
    // on the first tool call instead of surfacing here in the retry/circuit-breaker loop.
    //
    // ldapts has no persistent-connection error event to hook (unlike ioredis/mongodb) —
    // a dropped connection surfaces as a rejection on the next bind/search/etc. call, at
    // which point the tool call itself fails; BaseConnection's next getClient() call will
    // then re-run attemptConnect() since this.client isn't cleared here proactively.
    await client.bind(this.bindDn ?? "", this.bindPassword ?? "");
    return client;
  }

  protected async pingClient(client: Client): Promise<void> {
    await client.bind(this.bindDn ?? "", this.bindPassword ?? "");
  }

  protected async closeClient(client: Client): Promise<void> {
    await client.unbind();
  }
}

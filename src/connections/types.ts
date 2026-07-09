export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "retrying"
  | "failed"
  | "circuit_open";

export interface ConnectionErrorInfo {
  message: string;
  at: string;
}

export interface ConnectionStatus {
  id: string;
  type: string;
  state: ConnectionState;
  readOnly: boolean;
  lastError?: ConnectionErrorInfo;
  nextRetryAt?: string;
}

export interface ConnectionUnavailable {
  ok: false;
  status: ConnectionStatus;
}

export interface ConnectionAvailable<TClient> {
  ok: true;
  client: TClient;
}

export type ClientResult<TClient> = ConnectionAvailable<TClient> | ConnectionUnavailable;

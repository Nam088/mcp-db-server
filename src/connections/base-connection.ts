import { circuitBreaker, handleAll, ConsecutiveBreaker, BrokenCircuitError, type CircuitBreakerPolicy } from "cockatiel";
import type { ConnectionState, ConnectionStatus, ClientResult, ConnectionErrorInfo } from "./types.js";

export interface BaseConnectionOptions {
  id: string;
  type: string;
  readOnly?: boolean;
  maxConsecutiveFailures?: number;
  circuitResetMs?: number;
  maxBackoffMs?: number;
  baseBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Node wraps dual-stack connection failures (e.g. ECONNREFUSED) in an AggregateError
 * whose own .message is empty; unwrap it so lastError is actually useful to read.
 */
function extractErrorMessage(err: Error): string {
  if (err.message) return err.message;
  if (err instanceof AggregateError && err.errors.length > 0) {
    return err.errors.map((sub) => (sub instanceof Error ? sub.message : String(sub))).join("; ");
  }
  return String(err);
}

export abstract class BaseConnection<TClient> {
  readonly id: string;
  readonly type: string;
  readonly readOnly: boolean;

  private _state: ConnectionState = "idle";
  private _lastError?: ConnectionErrorInfo;
  private _nextRetryAt?: string;
  private client?: TClient;
  private running = false;
  private isLooping = false;
  private readonly breaker: CircuitBreakerPolicy;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(options: BaseConnectionOptions) {
    this.id = options.id;
    this.type = options.type;
    this.readOnly = options.readOnly ?? true;
    this.baseBackoffMs = options.baseBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.maxRetries = options.maxRetries ?? 3;
    this.breaker = circuitBreaker(handleAll, {
      halfOpenAfter: options.circuitResetMs ?? 30_000,
      breaker: new ConsecutiveBreaker(options.maxConsecutiveFailures ?? 5),
    });
  }

  get state(): ConnectionState {
    return this._state;
  }

  getStatus(): ConnectionStatus {
    return {
      id: this.id,
      type: this.type,
      state: this._state,
      readOnly: this.readOnly,
      lastError: this._lastError,
      nextRetryAt: this._nextRetryAt,
    };
  }

  /** Kicks off background connection attempts. Never awaited by tool handlers. */
  start(): void {
    if (this.running) return;
    this.running = true;
    if (!this.isLooping) {
      void this.loop();
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    const client = this.client;
    this.client = undefined;
    this._state = "idle";
    if (client) {
      try {
        await this.closeClient(client);
      } catch {
        // ignore
      }
    }
  }

  protected abstract closeClient(client: TClient): Promise<void>;

  /** Never blocks: reports the current state and (re)starts the connection loop in the background if needed. */
  async getClient(): Promise<ClientResult<TClient>> {
    if (this._state === "connected" && this.client !== undefined) {
      return { ok: true, client: this.client };
    }

    if (!this.running) {
      this.start();
    }

    return { ok: false, status: this.getStatus() };
  }

  /** Concrete adapters call this from their driver's error listener on an established connection. */
  protected onFatalError(err: Error): void {
    this.client = undefined;
    this.recordFailure(err);
    this._state = "failed";
    if (this.running && !this.isLooping) {
      void Promise.resolve().then(() => {
        if (this.running && !this.isLooping) {
          void this.loop();
        }
      });
    }
  }

  private async loop(): Promise<void> {
    this.isLooping = true;
    let attempt = 0;
    try {
      while (this.running) {
        this._state = attempt === 0 ? "connecting" : "retrying";
        this._nextRetryAt = undefined;
        try {
          this.client = await this.breaker.execute(() => this.attemptConnect());
          this._state = "connected";
          this._lastError = undefined;
          return;
        } catch (err) {
          attempt++;
          if (err instanceof BrokenCircuitError) {
            this._state = "circuit_open";
          } else {
            this.recordFailure(err instanceof Error ? err : new Error(String(err)));
            this._state = "failed";
          }
          if (attempt >= this.maxRetries) {
            this.running = false;
            this._nextRetryAt = undefined;
            break;
          }
          const delay = Math.min(this.baseBackoffMs * 2 ** (attempt - 1), this.maxBackoffMs);
          this._nextRetryAt = new Date(Date.now() + delay).toISOString();
          await this.sleep(delay);
        }
      }
    } finally {
      this.isLooping = false;
    }
  }

  private recordFailure(err: Error): void {
    this._lastError = { message: extractErrorMessage(err), at: new Date().toISOString() };
  }

  protected abstract attemptConnect(): Promise<TClient>;
}

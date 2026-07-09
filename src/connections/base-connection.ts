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
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export abstract class BaseConnection<TClient> {
  readonly id: string;
  readonly type: string;
  readonly readOnly: boolean;

  private _state: ConnectionState = "idle";
  private _lastError?: ConnectionErrorInfo;
  private _nextRetryAt?: string;
  private client?: TClient;
  private running = false;
  private readonly breaker: CircuitBreakerPolicy;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: BaseConnectionOptions) {
    this.id = options.id;
    this.type = options.type;
    this.readOnly = options.readOnly ?? true;
    this.baseBackoffMs = options.baseBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    this.sleep = options.sleep ?? defaultSleep;
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
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  getClient(): ClientResult<TClient> {
    if (this._state === "connected" && this.client !== undefined) {
      return { ok: true, client: this.client };
    }
    return { ok: false, status: this.getStatus() };
  }

  /** Concrete adapters call this from their driver's error listener on an established connection. */
  protected onFatalError(err: Error): void {
    this.client = undefined;
    this.recordFailure(err);
    this._state = "failed";
    if (!this.running) {
      this.start();
    }
  }

  private async loop(): Promise<void> {
    let attempt = 0;
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
        const delay = Math.min(this.baseBackoffMs * 2 ** (attempt - 1), this.maxBackoffMs);
        this._nextRetryAt = new Date(Date.now() + delay).toISOString();
        await this.sleep(delay);
      }
    }
  }

  private recordFailure(err: Error): void {
    this._lastError = { message: err.message, at: new Date().toISOString() };
  }

  protected abstract attemptConnect(): Promise<TClient>;
}

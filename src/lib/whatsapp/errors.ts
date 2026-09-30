/**
 * Graph API failures, classified.
 *
 * Meta's numbering is the contract, and the outbox acts on the CLASS, never on
 * the number: a throttle backs off, an auth failure pauses the whole market
 * and alerts a human, an undeliverable number is never retried, a template
 * problem freezes that template until the next sync.
 */

export type GraphErrorKind =
  | "throttle"
  | "transient"
  | "auth"
  | "window_closed"
  | "undeliverable"
  | "marketing_cap"
  | "template"
  | "invalid_request"
  | "spam_pause"
  | "account_paused"
  | "unknown";

export interface GraphErrorClass {
  kind: GraphErrorKind;
  retryable: boolean;
  /** Set the market's config to this status; rows stay queued. */
  pauseMarket?: "auth_failed" | "paused";
  /** Do not send anything for this market for this long. */
  deferMarketMs?: number;
  /** Lower cap than the outbox default. */
  maxAttempts?: number;
}

/** Strip a token out of anything Meta echoes back. */
export function redact(text: string): string {
  return text.replace(/access_token=[^&\s"]+/gi, "access_token=[REDACTED]");
}

export class WhatsAppApiError extends Error {
  readonly code: number | null;
  readonly subcode: number | null;
  readonly httpStatus: number | null;
  readonly title: string | null;
  readonly details: string | null;
  readonly fbtraceId: string | null;
  readonly isTimeout: boolean;

  constructor(
    message: string,
    opts: {
      code?: number | null;
      subcode?: number | null;
      httpStatus?: number | null;
      title?: string | null;
      details?: string | null;
      fbtraceId?: string | null;
      isTimeout?: boolean;
    } = {},
  ) {
    super(redact(message));
    this.name = "WhatsAppApiError";
    this.code = opts.code ?? null;
    this.subcode = opts.subcode ?? null;
    this.httpStatus = opts.httpStatus ?? null;
    this.title = opts.title ? redact(opts.title) : null;
    this.details = opts.details ? redact(opts.details) : null;
    this.fbtraceId = opts.fbtraceId ?? null;
    this.isTimeout = opts.isTimeout ?? false;
  }
}

const THROTTLE_CODES = new Set([4, 17, 613, 80007, 130429, 131056, 131016]);
const INVALID_CODES = new Set([100, 131008, 131009, 131021, 131051]);
const ACCOUNT_PAUSED_CODES = new Set([131031, 131042, 131037]);

const HOUR_MS = 60 * 60 * 1000;

export function classifyGraphError(err: unknown): GraphErrorClass {
  if (!(err instanceof WhatsAppApiError)) {
    // A plain network failure (DNS, reset) arrives as a TypeError from fetch.
    if (err instanceof TypeError) return { kind: "transient", retryable: true };
    return { kind: "unknown", retryable: false };
  }
  if (err.isTimeout) return { kind: "transient", retryable: true };

  const code = err.code;
  const status = err.httpStatus;

  if (code !== null) {
    if (THROTTLE_CODES.has(code)) return { kind: "throttle", retryable: true };
    if (code === 131000) return { kind: "transient", retryable: true, maxAttempts: 3 };
    if (code === 190 || code === 10 || (code >= 200 && code <= 299)) {
      return { kind: "auth", retryable: false, pauseMarket: "auth_failed", deferMarketMs: HOUR_MS };
    }
    if (code === 131047) return { kind: "window_closed", retryable: false };
    if (code === 131026) return { kind: "undeliverable", retryable: false };
    if (code === 131049) return { kind: "marketing_cap", retryable: false };
    if (code >= 132000 && code <= 132069) return { kind: "template", retryable: false };
    if (INVALID_CODES.has(code)) return { kind: "invalid_request", retryable: false };
    if (code === 131048) return { kind: "spam_pause", retryable: true, deferMarketMs: 2 * HOUR_MS };
    if (ACCOUNT_PAUSED_CODES.has(code)) {
      return { kind: "account_paused", retryable: true, pauseMarket: "paused" };
    }
  }

  if (status === 429) return { kind: "throttle", retryable: true };
  if (status !== null && status >= 500) return { kind: "transient", retryable: true };

  return { kind: "unknown", retryable: false };
}

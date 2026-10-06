/**
 * Calls to outside services → public.integration_calls, FAILURES ONLY
 * (plans/journal-detection-and-settings-v2.md §B).
 *
 * Until 2026-10-06 only the carrier upload was recorded: a Darb poll answering
 * 401, Meta refusing a token or WhatsApp timing out left no trace. Every
 * outside client now fetches through `monitoredFetch(system, operation)`.
 * Successes are not written — the carrier polls alone would add ~20 000 rows
 * a day — so the rule `external_failing` counts failures per hour.
 *
 * Never changes what the caller sees: the response (body still readable) is
 * returned, a throw is re-thrown, a recorder that fails is swallowed.
 */
import { recordIntegrationCall, type IntegrationCallInput, type IntegrationOperation } from "./record-call";
import { noteCause } from "./request-context";

export type ExternalSystem = "darb_assabil" | "navex" | "dexpress" | "meta" | "whatsapp" | "google_sheets" | (string & {});

type Recorder = (input: IntegrationCallInput) => Promise<void>;

export interface MonitorOptions {
  connectionId?: string | null;
  marketId?: string | null;
  orderId?: string | null;
  /** Injected in tests; defaults to a service-role PostgREST insert. */
  record?: Recorder;
}

const BODY_MAX = 2000;
const THROTTLE_MS = 60_000;
/** Last time each (system, operation, code) failure was written, per server instance. */
const lastWritten = new Map<string, number>();

/**
 * A dead outside service answers every poll with the same error: 139 Navex
 * parcels every 10 minutes would be ~20 000 rows a day. One row per minute per
 * system, operation and code is plenty for an hourly rule.
 */
function shouldWrite(key: string): boolean {
  const now = Date.now();
  const last = lastWritten.get(key);
  if (last !== undefined && now - last < THROTTLE_MS) return false;
  lastWritten.set(key, now);
  return true;
}

/** Status, code and message of a failed answer, read from the usual JSON shapes. */
export function failureOf(
  httpStatus: number,
  text: string,
): { status: "refused" | "error"; errorCode: string | null; message: string | null } {
  const status = httpStatus >= 500 ? "error" : "refused";
  let errorCode: string | null = httpStatus === 429 ? "rate_limited" : null;
  let message: string | null = text ? text.slice(0, 300) : null;
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const inner = (body.error && typeof body.error === "object" ? body.error : body) as Record<string, unknown>;
    const m = inner.message ?? inner.error_description ?? (typeof body.error === "string" ? body.error : undefined) ?? inner.msg;
    if (typeof m === "string" && m) message = m;
    if (!errorCode && inner.code != null) errorCode = String(inner.code);
  } catch {
    // not JSON: keep the text
  }
  return { status, errorCode, message };
}

function networkCode(err: unknown): string | null {
  const e = err as { name?: string; code?: string; cause?: { code?: string } } | null;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  return e?.cause?.code ?? e?.code ?? "network";
}

async function defaultRecord(input: IntegrationCallInput): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || process.env.NODE_ENV === "test") return;
  const insertOnly = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) =>
        fetch(`${url}/rest/v1/${table}`, {
          method: "POST",
          headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(row),
          signal: AbortSignal.timeout(1500),
        }),
    }),
  };
  await recordIntegrationCall(insertOnly, input);
}

export function monitoredFetch(
  system: ExternalSystem,
  operation: IntegrationOperation,
  options: MonitorOptions = {},
): typeof fetch {
  const record = options.record ?? defaultRecord;
  const base = {
    system,
    operation,
    connectionId: options.connectionId ?? null,
    marketId: options.marketId ?? null,
    orderId: options.orderId ?? null,
  };
  const safeRecord = async (input: IntegrationCallInput) => {
    if (!shouldWrite(`${system}|${operation}|${input.httpStatus ?? input.errorCode ?? ""}`)) return;
    try {
      await record(input);
    } catch {
      // The journal must never turn an outside answer into another error.
    }
  };

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(input, init);
    } catch (err) {
      const code = networkCode(err);
      const message = err instanceof Error ? err.message : String(err);
      noteCause({ kind: "external", code, detail: message, target: system });
      await safeRecord({
        ...base,
        status: code === "timeout" ? "timeout" : "error",
        httpStatus: null,
        errorCode: code,
        message,
        durationMs: Date.now() - started,
      });
      throw err;
    }
    if (res && res.status >= 400) {
      let text = "";
      try {
        text = (await res.clone().text()).slice(0, BODY_MAX);
      } catch {
        text = "";
      }
      const f = failureOf(res.status, text);
      noteCause({ kind: "external", code: String(res.status), detail: f.message, target: system });
      await safeRecord({ ...base, ...f, httpStatus: res.status, durationMs: Date.now() - started });
    }
    return res;
  }) as typeof fetch;
}

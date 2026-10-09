import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What actually went wrong during one request (plans/journal-detection-and-settings-v2.md §A).
 *
 * 179 routes answer « Internal server error » after catching the real error, so
 * `withRouteErrors` used to record that sentence and nothing else — 720
 * `/api/cities` failures on prod said nothing about an empty market id. Each
 * request now carries a small list of causes, filled from three places that
 * already see the truth: the Supabase clients' fetch, the outside-service
 * fetch (`monitoredFetch`), and `console.error`. The wrapper picks the most
 * telling one when the answer is a 500. Outside a request every call is a no-op.
 */

export type CauseKind = "db" | "external" | "code";

export interface Cause {
  kind: CauseKind;
  /** SQLSTATE, PostgREST code, HTTP status or a short machine code. */
  code: string | null;
  detail: string | null;
  /** The table, `rpc:<fn>`, `auth`, or the outside system. */
  target: string | null;
}

const MAX_CAUSES = 10;
const store = new AsyncLocalStorage<Cause[]>();

export function runWithCauses<T>(fn: () => T): T {
  return store.run([], fn);
}

export function noteCause(cause: Cause): void {
  const list = store.getStore();
  if (!list) return;
  if (list.length >= MAX_CAUSES) list.shift();
  list.push(cause);
}

export function currentCauses(): Cause[] {
  return [...(store.getStore() ?? [])];
}

const RANK: Record<CauseKind, number> = { db: 3, external: 2, code: 1 };

/** The cause to keep: the strongest kind, and among equals the latest. */
export function pickCause(causes: Cause[]): Cause | null {
  let best: Cause | null = null;
  for (const c of causes) if (!best || RANK[c.kind] >= RANK[best.kind]) best = c;
  return best;
}

/* ── Supabase ─────────────────────────────────────────────────────────────── */

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** `cities`, `rpc:get_team_day`, `auth`, `storage` — what a Supabase URL points at. */
export function supabaseTarget(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const rest = path.match(/\/rest\/v1\/(rpc\/)?([^/?]+)/);
    if (rest) return rest[1] ? `rpc:${rest[2]}` : rest[2];
    const svc = path.match(/^\/(auth|storage|functions)\/v1\//);
    return svc ? svc[1] : null;
  } catch {
    return null;
  }
}

/**
 * A fetch for the Supabase clients that notes every answer ≥ 400 (and every
 * network failure) as a `db` cause. The response itself is returned untouched.
 */
export function capturingFetch(base: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    let res: Response;
    try {
      res = await base(input, init);
    } catch (err) {
      noteCause({ kind: "db", code: "network", detail: err instanceof Error ? err.message : String(err), target: supabaseTarget(url) });
      throw err;
    }
    if (res.status >= 400 && store.getStore()) {
      try {
        const body = (await res.clone().json()) as Record<string, unknown>;
        const code = body.code ?? body.error_code ?? body.error;
        const message = body.message ?? body.msg ?? body.error_description;
        noteCause({
          kind: "db",
          code: code == null ? String(res.status) : String(code),
          detail: [message, body.details, body.hint].filter((x) => typeof x === "string" && x).join(" — ") || null,
          target: supabaseTarget(url),
        });
      } catch {
        noteCause({ kind: "db", code: String(res.status), detail: null, target: supabaseTarget(url) });
      }
    }
    return res;
  }) as typeof fetch;
}

/* ── console.error ────────────────────────────────────────────────────────── */

const WRAPPED = Symbol.for("ordra.journal.consoleCapture");

function describeArg(a: unknown): { text: string; code: string | null } {
  if (a instanceof Error) return { text: a.message, code: (a as { code?: unknown }).code ? String((a as { code?: unknown }).code) : null };
  if (a && typeof a === "object") {
    const o = a as { message?: unknown; code?: unknown };
    if (typeof o.message === "string") return { text: o.message, code: o.code == null ? null : String(o.code) };
    try {
      return { text: JSON.stringify(a), code: null };
    } catch {
      return { text: String(a), code: null };
    }
  }
  return { text: String(a), code: null };
}

/**
 * Notes every `console.error` made during a request. The original logger is
 * still called with the same arguments. Idempotent: wrapping the wrapper is a no-op.
 */
export function installConsoleCapture(): void {
  const current = console.error as typeof console.error & { [WRAPPED]?: true };
  if (current[WRAPPED]) return;
  const wrapper = ((...args: unknown[]) => {
    if (store.getStore()) {
      try {
        const parts = args.map(describeArg);
        noteCause({
          kind: "code",
          code: parts.find((p) => p.code)?.code ?? null,
          detail: parts.map((p) => p.text).join(" ").slice(0, 500),
          target: null,
        });
      } catch {
        // Logging must never fail because of the journal.
      }
    }
    current(...args);
  }) as typeof console.error & { [WRAPPED]?: true };
  wrapper[WRAPPED] = true;
  console.error = wrapper;
}

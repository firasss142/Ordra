import type { Cause } from "./request-context";

/**
 * Ordra's own server errors → public.app_errors (plans/journaux-redesign.md §3.2).
 *
 * Server-only. Written with a bare PostgREST call rather than the Supabase
 * client on purpose: route tests mock `@/lib/supabase/server`, and an extra
 * `.from("app_errors")` on those mocks would break assertions that have
 * nothing to do with errors. Outside a configured server (tests, scripts) the
 * recorder is a no-op.
 */

export interface AppErrorInput {
  route: string;
  method: string;
  status: number;
  errorCode: string | null;
  message: string | null;
  actorId: string | null;
  /** What really failed behind the answer (./request-context.ts). */
  cause?: Cause | null;
  /** 'server' (a route) or 'browser' (a crash reported by the page). */
  source?: "server" | "browser";
  /** For a browser crash: the page it happened on. */
  page?: string | null;
}

const MAX = 200;

/** Phones, e-mails and token-looking strings never reach the journal. */
export function redact(text: string | null | undefined, max: number = MAX): string | null {
  if (text == null) return null;
  const out = String(text)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "•••")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "•••")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "•••")
    .replace(/\s+/g, " ")
    .trim();
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}

/**
 * One problem per route, method, status and code — never per message. The
 * cause code joins it when the answer's own code is empty, so a route that
 * fails for two different reasons is two problems.
 */
export function fingerprintOf(
  e: Pick<AppErrorInput, "route" | "method" | "status" | "errorCode"> & { causeCode?: string | null },
): string {
  return [e.method, e.route, String(e.status), e.errorCode ?? e.causeCode].filter(Boolean).join(" ");
}

/** The app_errors row, without the columns added on 2026-10-06 when `legacy`. */
export function appErrorRow(e: AppErrorInput, legacy = false): Record<string, unknown> {
  const row: Record<string, unknown> = {
    route: e.route,
    method: e.method,
    status: e.status,
    error_code: e.errorCode ? String(e.errorCode).slice(0, 40) : null,
    message: redact(e.message),
    actor_id: e.actorId,
    fingerprint: fingerprintOf({ ...e, causeCode: e.cause?.code ?? null }),
  };
  if (legacy) return row;
  return {
    ...row,
    source: e.source ?? "server",
    page: e.page ? e.page.slice(0, 200) : null,
    cause_kind: e.cause?.kind ?? null,
    cause_code: e.cause?.code ? String(e.cause.code).slice(0, 40) : null,
    cause_detail: redact(e.cause?.detail, 400),
    cause_target: e.cause?.target ? String(e.cause.target).slice(0, 80) : null,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Who was signed in, read from the Supabase session cookie WITHOUT verifying
 * it: it only labels an error row, it never grants anything. The cookie may be
 * split in chunks (`sb-…-auth-token.0`, `.1`) and prefixed `base64-`.
 */
export function actorFromCookieHeader(header: string | null | undefined): string | null {
  if (!header) return null;
  try {
    const parts = new Map<string, string>();
    for (const pair of header.split(/;\s*/)) {
      const i = pair.indexOf("=");
      if (i < 0) continue;
      parts.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const base = [...parts.keys()].find((k) => /^sb-.+-auth-token(\.0)?$/.test(k))?.replace(/\.0$/, "");
    if (!base) return null;
    let raw = parts.get(base) ?? "";
    if (!raw) for (let n = 0; parts.has(`${base}.${n}`); n++) raw += parts.get(`${base}.${n}`);
    raw = decodeURIComponent(raw);
    const json = raw.startsWith("base64-") ? Buffer.from(raw.slice(7), "base64").toString("utf8") : raw;
    const token = (JSON.parse(json) as { access_token?: string }).access_token;
    const payload = token?.split(".")[1];
    if (!payload) return null;
    const sub = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string }).sub;
    return sub && UUID.test(sub) ? sub : null;
  } catch {
    return null;
  }
}

export async function recordAppError(e: AppErrorInput): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || process.env.NODE_ENV === "test") return;
  const post = (row: Record<string, unknown>) =>
    fetch(`${url}/rest/v1/app_errors`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(3000),
    });
  const res = await post(appErrorRow(e));
  // Before 20261006120000 is pasted the cause columns do not exist (PGRST204):
  // keep the row, lose only the cause.
  if (res.status === 400) await post(appErrorRow(e, true));
}

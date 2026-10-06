/**
 * « Pourquoi » and « Que faire » for every Journaux problem
 * (plans/journal-detection-and-settings-v2.md §F).
 *
 * Pure: (rule, params) → translation keys under `journaux.explain.*` plus the
 * values they need. Only the rules whose meaning depends on a recorded cause
 * are explained here; every other rule already has its own « Ce qui se passe »
 * and steps under `journaux.rules.<rule>`. The sentences live in src/messages/{fr,ar}.json; this
 * file only decides WHICH explanation fits. A server error is explained by the
 * cause recorded with it (SQLSTATE / PostgREST code / outside HTTP status), so
 * « Internal server error » becomes « Ordra a envoyé une valeur vide à la base ».
 */
import type { CauseKind } from "./request-context";

export interface Phrase {
  key: string;
  params: Record<string, string | number>;
}

export interface Explanation {
  why: Phrase;
  fix: Phrase;
}

export const CAUSE_KEYS = [
  "bad_value",
  "duplicate",
  "missing_link",
  "missing_field",
  "rule_check",
  "no_permission",
  "schema_mismatch",
  "db_slow",
  "conflict",
  "no_row",
  "business_rule",
  "db_unreachable",
  "db_other",
  "ext_timeout",
  "ext_credentials",
  "ext_rate_limit",
  "ext_not_found",
  "ext_refused",
  "ext_down",
  "ext_network",
  "code_missing_data",
  "code_bug",
  "unknown",
] as const;
export type CauseKey = (typeof CAUSE_KEYS)[number];

/** Every key explainIssue can return, without the `.why` / `.fix` suffix. */
export const EXPLAIN_KEYS: string[] = CAUSE_KEYS.map((k) => `cause.${k}`);

/** The rules whose explanation depends on the recorded cause, not on the rule alone. */
export const CAUSE_RULES = ["server_error", "external_failing", "browser_error"] as const;

const SYSTEM_NAMES: Record<string, string> = {
  darb_assabil: "Darb Assabil",
  navex: "Navex",
  dexpress: "Dexpress",
  meta: "Meta",
  whatsapp: "WhatsApp",
  google_sheets: "Google Sheets",
};

export function systemName(system: unknown): string {
  const s = typeof system === "string" ? system : "";
  return SYSTEM_NAMES[s] ?? s;
}

interface CauseLike {
  kind: CauseKind | string | null;
  code: string | null;
  detail?: string | null;
}

const NETWORK = /^(network|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EPIPE|UND_ERR_\w+)$/;

export function causeKey(cause: CauseLike | null | undefined): CauseKey {
  if (!cause || !cause.kind) return "unknown";
  const code = (cause.code ?? "").trim();

  if (cause.kind === "external") {
    if (code === "timeout") return "ext_timeout";
    if (NETWORK.test(code)) return "ext_network";
    const http = Number(code);
    if (http === 401 || http === 403) return "ext_credentials";
    if (http === 429 || code === "rate_limited") return "ext_rate_limit";
    if (http === 404) return "ext_not_found";
    if (http >= 500) return "ext_down";
    if (http >= 400) return "ext_refused";
    return "ext_down";
  }

  if (cause.kind === "db") {
    if (code === "22P02" || code === "22007" || code === "22003" || code === "22023") return "bad_value";
    if (code === "23505") return "duplicate";
    if (code === "23503") return "missing_link";
    if (code === "23502") return "missing_field";
    if (code === "23514" || code === "23P01") return "rule_check";
    if (code === "42501" || code === "PGRST301" || code === "PGRST302" || code === "401" || code === "403") return "no_permission";
    if (["42703", "42883", "42P01", "PGRST200", "PGRST202", "PGRST204", "PGRST205"].includes(code)) return "schema_mismatch";
    if (code === "57014") return "db_slow";
    if (code === "40001" || code === "40P01" || code === "55P03") return "conflict";
    if (code === "PGRST116") return "no_row";
    if (code === "P0001") return "business_rule";
    if (code === "network" || code.startsWith("08") || code === "53300" || code === "53400" || code === "57P01") return "db_unreachable";
    return "db_other";
  }

  if (/Cannot read propert(y|ies) of (undefined|null)|is not iterable|undefined is not/i.test(cause.detail ?? "")) {
    return "code_missing_data";
  }
  return "code_bug";
}

function phrases(base: string, params: Record<string, string | number>): Explanation {
  return { why: { key: `${base}.why`, params }, fix: { key: `${base}.fix`, params } };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null;
}

export function explainIssue(rule: string, params: Record<string, unknown>): Explanation | null {
  if (rule === "server_error" || rule === "browser_error") {
    const key = causeKey(
      params.cause_kind ? { kind: String(params.cause_kind), code: str(params.cause_code), detail: str(params.cause_detail) } : null,
    );
    const target = str(params.cause_target);
    return phrases(`cause.${key}`, target ? { target } : {});
  }

  if (rule === "external_failing") {
    const http = params.http_status == null ? null : String(params.http_status);
    const key = causeKey({ kind: "external", code: http ?? str(params.code) });
    return phrases(`cause.${key}`, { target: systemName(params.system) });
  }

  return null;
}

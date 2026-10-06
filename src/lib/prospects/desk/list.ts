/**
 * The desk's list: what the filter bar sends, how the route turns it into a
 * PostgREST query, and the CSV the export writes. Pure.
 *
 * The state definitions here are the SQL facts' definitions (desk/types.ts
 * stateOf): a prospect counted « ramené » on a card must be the one the list
 * shows under « Ramenés ».
 */
import { DESK_SOURCES, sourceOf, stateOf, type DeskSource, type DeskState } from "./types";

export const PAGE_SIZE = 25;
export type ListState = "open" | "won" | "lost" | "all";
const STATES: ListState[] = ["open", "won", "lost", "all"];

export interface ListQuery {
  sources: DeskSource[];
  /** Agent ids, plus "none" for prospects with no agent. */
  agents: string[];
  state: ListState;
  q: string;
  page: number;
  pageSize: number;
  /** One prospect, whatever its state: where an old /leads/[id] link lands. */
  id?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const multi = (p: URLSearchParams, key: string) =>
  [...new Set(p.getAll(key).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean))];

export function parseListQuery(p: URLSearchParams): ListQuery {
  const state = p.get("state") as ListState;
  const page = Math.trunc(Number(p.get("page")));
  return {
    sources: multi(p, "src").filter((s): s is DeskSource => (DESK_SOURCES as string[]).includes(s)),
    agents: multi(p, "agent").filter((a) => a === "none" || UUID.test(a)),
    state: STATES.includes(state) ? state : "open",
    q: (p.get("q") ?? "").trim(),
    page: Number.isFinite(page) && page > 1 ? page : 1,
    pageSize: PAGE_SIZE,
    ...(UUID.test(p.get("id") ?? "") ? { id: p.get("id")! } : {}),
  };
}

const AUTOMATIC: Record<Exclude<DeskSource, "camp">, string> = { rej: "rejected_order", ret: "winback", old: "repeat_buyer" };
const AUTOMATIC_LIST = "rejected_order,winback,repeat_buyer";

/** One `.or()` string for the selected sources, or null for « toutes ». */
export function sourceOrFilter(sources: DeskSource[]): string | null {
  if (!sources.length) return null;
  const parts: string[] = [];
  const auto = sources.filter((s): s is Exclude<DeskSource, "camp"> => s !== "camp").map((s) => AUTOMATIC[s]);
  if (auto.length) parts.push(`source.in.(${auto.join(",")})`);
  if (sources.includes("camp")) parts.push(`source.not.in.(${AUTOMATIC_LIST})`);
  return parts.join(",");
}

export function agentOrFilter(agents: string[]): string | null {
  if (!agents.length) return null;
  const ids = agents.filter((a) => a !== "none");
  const parts: string[] = [];
  if (agents.includes("none")) parts.push("assigned_to.is.null");
  if (ids.length) parts.push(`assigned_to.in.(${ids.join(",")})`);
  return parts.join(",");
}

export const OPEN_STATUSES = ["new", "assigned", "attempt_1", "attempt_2", "attempt_3", "callback_scheduled", "qualified"];

export function stateFilter(state: ListState): { statusIn?: string[]; convertedNull?: boolean; or?: string } {
  if (state === "open") return { statusIn: OPEN_STATUSES, convertedNull: true };
  if (state === "won") return { or: "converted_order_id.not.is.null,status.eq.won" };
  if (state === "lost") return { statusIn: ["lost", "archived"], convertedNull: true };
  return {};
}

export interface CsvColumn { key: string; label: string }

/**
 * RFC 4180 with two Excel courtesies: a BOM so Arabic opens readable, and
 * formula injection neutralised (a cell starting = + - @ would run).
 */
export function toCsv(rows: Record<string, unknown>[], cols: CsvColumn[], opts: { sep: "," | ";"; bom: boolean }): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /["\r\n,;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => cell(c.label)).join(opts.sep), ...rows.map((r) => cols.map((c) => cell(r[c.key])).join(opts.sep))];
  return (opts.bom ? "﻿" : "") + lines.join("\r\n") + "\r\n";
}

/** One row of the desk's list, flattened for the view and the export. */
export interface DeskRow {
  id: string;
  name: string;
  phone: string;
  city: string | null;
  source: DeskSource;
  leadSource: string;
  state: DeskState;
  status: string;
  /** attempt_N → N; anything else → 0. */
  attempts: number;
  /** rej: the rejection sub-reason; ret: the courier's remark. */
  reason: string | null;
  campaignName: string | null;
  productName: string | null;
  productPrice: number | null;
  productImage: string | null;
  agentId: string | null;
  agentName: string | null;
  agentColor: string | null;
  callbackAt: string | null;
  lateCallback: boolean;
  sourceOrderId: string | null;
  sourceOrderRef: string | null;
  /** What is at stake: the product's price, else the source order's total. */
  value: number | null;
  convertedOrderId: string | null;
  convertedRef: string | null;
  convertedStatus: string | null;
  createdAt: string;
  ageDays: number;
}

type Embed<T> = T | T[] | null | undefined;
const one = <T,>(v: Embed<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v) ?? null;
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

export function toDeskRow(r: Record<string, unknown>, now: Date = new Date()): DeskRow {
  const product = one(r.products as Embed<{ name: string | null; default_price: number | null; image_url: string | null }>);
  const agent = one(r.agent as Embed<{ full_name: string | null; color: string | null }>);
  const campaign = one(r.campaign as Embed<{ name: string | null }>);
  const src = one(r.source_order as Embed<{ external_id: string | null; total_price: number | null }>);
  const conv = one(r.converted as Embed<{ external_id: string | null; status: string | null }>);
  const status = String(r.status);
  const callbackAt = str(r.callback_scheduled_at);
  const created = String(r.created_at);
  const attempt = /^attempt_(\d)$/.exec(status);
  return {
    id: String(r.id),
    name: String(r.customer_name ?? ""),
    phone: String(r.customer_phone ?? ""),
    city: str(r.customer_city),
    source: sourceOf(String(r.source)),
    leadSource: String(r.source),
    state: stateOf(status, str(r.converted_order_id)),
    status,
    attempts: attempt ? Number(attempt[1]) : 0,
    reason: str(r.return_reason),
    campaignName: campaign?.name ?? null,
    productName: product?.name ?? null,
    productPrice: num(product?.default_price),
    productImage: product?.image_url ?? null,
    agentId: str(r.assigned_to),
    agentName: agent?.full_name ?? null,
    agentColor: agent?.color ?? null,
    callbackAt,
    lateCallback: status === "callback_scheduled" && callbackAt !== null && Date.parse(callbackAt) < now.getTime(),
    sourceOrderId: str(r.source_order_id),
    sourceOrderRef: src?.external_id ?? null,
    value: num(product?.default_price) ?? num(src?.total_price),
    convertedOrderId: str(r.converted_order_id),
    convertedRef: conv?.external_id ?? null,
    convertedStatus: conv?.status ?? null,
    createdAt: created,
    ageDays: Math.max(0, Math.floor((now.getTime() - Date.parse(created)) / 86_400_000)),
  };
}

/** The select the list and the export share. Column hints: leads has two FKs to orders. */
export const DESK_ROW_SELECT = `id, status, source, customer_name, customer_phone, customer_city, assigned_to,
  callback_scheduled_at, converted_order_id, campaign_id, source_order_id, return_reason, created_at,
  products:product_interest_id ( name, default_price, image_url ),
  agent:assigned_to ( full_name, color ),
  campaign:campaign_id ( name ),
  source_order:source_order_id ( external_id, total_price ),
  converted:converted_order_id ( external_id, status )`;

/**
 * Several OR groups that must all hold. PostgREST refuses two `or=` params, and
 * supabase-js has no `.and()`, so they travel as one `.or(and(or(…),or(…)))` —
 * checked against the local PostgREST on 2026-10-06, not just in a mock.
 */
export function combinedOr(groups: (string | null)[]): string | null {
  const g = groups.filter((x): x is string => Boolean(x));
  return g.length ? `and(${g.map((x) => `or(${x})`).join(",")})` : null;
}

/** Name or phone, scrubbed: `.or()` syntax characters would open a condition of the caller's choosing. */
export function searchOrFilter(raw: string): string | null {
  const safe = raw.replace(/[^\p{L}\p{N} +-]/gu, " ").trim().replace(/\s+/g, " ").slice(0, 60);
  return safe ? `customer_name.ilike.*${safe}*,customer_phone.ilike.*${safe}*` : null;
}

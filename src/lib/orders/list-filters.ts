import { z } from "zod";
import { ORDER_STATUSES, type OrderStatus } from "@/types/order-status";

/**
 * The four work shortcuts above the Commandes list (prototypes/commandes-v4.html
 * `TILES`). Each one counts exactly the list it opens: the count and the list
 * read the same predicate (lib/orders/list-query + get_orders_work_counts).
 *
 *   today           received since the market's midnight
 *   unassigned      pending AND no agent — not "no agent, any status"
 *   recall          a call to make again: attempt_1..3 + callback_scheduled
 *   uploaded_today  sent to the carrier since midnight, whatever it became since
 */
export type OrdersPreset = "all" | "today" | "unassigned" | "recall" | "uploaded_today";

export const ORDERS_PRESETS: OrdersPreset[] = ["all", "today", "unassigned", "recall", "uploaded_today"];

/** Old deep links (alerts, bookmarks) keep landing somewhere sensible. */
const LEGACY_PRESETS: Record<string, OrdersPreset> = { callbacks: "recall" };

export const RECALL_STATUSES = ["attempt_1", "attempt_2", "attempt_3", "callback_scheduled"] as const;

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

function isPageSize(n: number): n is PageSize {
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n);
}

/**
 * Which view of the orders table is being read: the working list, or Archivées.
 * The archive has four tabs; `deleted` is the soft-deleted orders, which live
 * there and nowhere else since the v2 prototype.
 */
export type OrdersScope = "orders" | "archive";
export type ArchiveTab = "eligible" | "archived" | "recent" | "deleted";
export const ARCHIVE_TABS: ArchiveTab[] = ["eligible", "archived", "recent", "deleted"];

/** "No agent" / "no city" / "not sent yet" as a pickable value of a facet. */
export const NONE = "none";
export const UNASSIGNED = "unassigned";

export interface OrderListFilters {
  preset: OrdersPreset;
  scope: OrdersScope;
  archiveTab: ArchiveTab;
  marketId: string | null;
  q: string;
  statuses: OrderStatus[];
  /** agent uuids, or "unassigned" */
  agentIds: string[];
  storefrontIds: string[];
  /** city names, or "none" */
  cities: string[];
  productIds: string[];
  /** carrier uuids, or "none" */
  carrierIds: string[];
  dateFrom: string | null;
  dateTo: string | null;
  pageSize: PageSize;
}

export const DEFAULT_FILTERS: OrderListFilters = {
  preset: "all",
  scope: "orders",
  archiveTab: "eligible",
  marketId: null,
  q: "",
  statuses: [],
  agentIds: [],
  storefrontIds: [],
  cities: [],
  productIds: [],
  carrierIds: [],
  dateFrom: null,
  dateTo: null,
  pageSize: DEFAULT_PAGE_SIZE,
};

const isStatus = (v: string): v is OrderStatus => (ORDER_STATUSES as readonly string[]).includes(v);

export function readPreset(raw: string | null | undefined): OrdersPreset {
  const v = raw ?? "all";
  if ((ORDERS_PRESETS as string[]).includes(v)) return v as OrdersPreset;
  return LEGACY_PRESETS[v] ?? "all";
}

export function readArchiveTab(raw: string | null | undefined): ArchiveTab {
  return (ARCHIVE_TABS as string[]).includes(raw ?? "") ? (raw as ArchiveTab) : "eligible";
}

/** A CSV query parameter as a clean list: trimmed, no blanks, no repeats. */
export function csvList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return Array.from(new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)));
}

function isoDate(v: string | null): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function parseFiltersFromSearchParams(params: URLSearchParams): OrderListFilters {
  const limitRaw = params.get("limit");
  const limitNum = limitRaw === null ? NaN : Number(limitRaw);
  const scope: OrdersScope = params.get("scope") === "archive" ? "archive" : "orders";
  return {
    preset: readPreset(params.get("preset")),
    scope,
    archiveTab: readArchiveTab(params.get("state")),
    marketId: null,
    q: params.get("q") ?? "",
    statuses: csvList(params.get("status")).filter(isStatus),
    agentIds: csvList(params.get("agent_id")),
    storefrontIds: csvList(params.get("storefront_id")),
    cities: csvList(params.get("city")),
    productIds: csvList(params.get("product_id")),
    carrierIds: csvList(params.get("carrier_id")),
    dateFrom: isoDate(params.get("date_from")),
    dateTo: isoDate(params.get("date_to")),
    pageSize: Number.isFinite(limitNum) && isPageSize(limitNum) ? limitNum : DEFAULT_PAGE_SIZE,
  };
}

/** Serialize filters for the address bar and the API (the market is added by the caller). */
export function filtersToSearchParams(filters: OrderListFilters): URLSearchParams {
  const p = new URLSearchParams();
  const list = (k: string, v: string[]) => {
    if (v.length) p.set(k, v.join(","));
  };
  if (filters.preset !== "all") p.set("preset", filters.preset);
  if (filters.scope !== "orders") p.set("scope", filters.scope);
  if (filters.scope === "archive" && filters.archiveTab !== "eligible") p.set("state", filters.archiveTab);
  if (filters.q) p.set("q", filters.q);
  list("status", filters.statuses);
  list("agent_id", filters.agentIds);
  list("storefront_id", filters.storefrontIds);
  list("city", filters.cities);
  list("product_id", filters.productIds);
  list("carrier_id", filters.carrierIds);
  if (filters.dateFrom) p.set("date_from", filters.dateFrom);
  if (filters.dateTo) p.set("date_to", filters.dateTo);
  if (filters.pageSize !== DEFAULT_PAGE_SIZE) p.set("limit", String(filters.pageSize));
  return p;
}

/** True if anything narrows the list beyond the market (page size and archive tab are views, not filters). */
export function hasActiveFilters(f: OrderListFilters): boolean {
  return (
    f.preset !== "all" ||
    f.q.trim().length > 0 ||
    f.statuses.length > 0 ||
    f.agentIds.length > 0 ||
    f.storefrontIds.length > 0 ||
    f.cities.length > 0 ||
    f.productIds.length > 0 ||
    f.carrierIds.length > 0 ||
    f.dateFrom !== null ||
    f.dateTo !== null
  );
}

export type ClearableFilterKey =
  | "preset"
  | "q"
  | "date"
  | "statuses"
  | "agentIds"
  | "storefrontIds"
  | "cities"
  | "productIds"
  | "carrierIds";

export function clearFilterField(filters: OrderListFilters, key: ClearableFilterKey): OrderListFilters {
  switch (key) {
    case "preset": return { ...filters, preset: "all" };
    case "q": return { ...filters, q: "" };
    case "date": return { ...filters, dateFrom: null, dateTo: null };
    default: return { ...filters, [key]: [] };
  }
}

/** Clear every filter; keep the market, the page size and which page (and tab) the user is on. */
export function resetFilters(current: OrderListFilters): OrderListFilters {
  return {
    ...DEFAULT_FILTERS,
    marketId: current.marketId,
    pageSize: current.pageSize,
    scope: current.scope,
    archiveTab: current.archiveTab,
  };
}

// ---------- API-side Zod schema (/api/orders/list, /facet-counts, /export) ----------

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  preset: z.preprocess((v) => readPreset(typeof v === "string" ? v : null), z.enum(["all", "today", "unassigned", "recall", "uploaded_today"])).default("all"),
  scope: z.enum(["orders", "archive"]).default("orders"),
  state: z.preprocess((v) => readArchiveTab(typeof v === "string" ? v : null), z.enum(["eligible", "archived", "recent", "deleted"])).default("eligible"),
  market_id: z.string().uuid().optional(),
  q: z.string().optional(),
  status: z.string().optional(), // csv
  agent_id: z.string().optional(), // csv, "unassigned" allowed
  storefront_id: z.string().optional(), // csv
  city: z.string().optional(), // csv, "none" allowed
  product_id: z.string().optional(), // csv
  carrier_id: z.string().optional(), // csv, "none" allowed
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

// ---------- Keyset cursor helpers ----------

import { encodeKeysetCursor, decodeKeysetCursor } from "@/lib/cursor";

export interface Cursor {
  createdAt: string; // ISO
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return encodeKeysetCursor({ timestamp: c.createdAt, id: c.id });
}

export function decodeCursor(raw: string): Cursor | null {
  const decoded = decodeKeysetCursor(raw);
  return decoded ? { createdAt: decoded.timestamp, id: decoded.id } : null;
}

import { z } from "zod";
import { ORDER_STATUSES, REJECTION_REASONS, type OrderStatus, type RejectionReason } from "@/types/order-status";

export type OrdersPreset = "all" | "unassigned" | "callbacks" | "today";

export const ORDERS_PRESETS: OrdersPreset[] = ["all", "unassigned", "callbacks", "today"];

export interface OrderListFilters {
  preset: OrdersPreset;
  marketId: string | null;
  q: string;
  statuses: OrderStatus[];
  agentId: string | "unassigned" | null;
  dateFrom: string | null;
  dateTo: string | null;
  productId: string | null;
  city: string;
  totalMin: number | null;
  totalMax: number | null;
  rejectionReason: RejectionReason | null;
  carrierId: string | null;
}

export const DEFAULT_FILTERS: OrderListFilters = {
  preset: "all",
  marketId: null,
  q: "",
  statuses: [],
  agentId: null,
  dateFrom: null,
  dateTo: null,
  productId: null,
  city: "",
  totalMin: null,
  totalMax: null,
  rejectionReason: null,
  carrierId: null,
};

const isPreset = (v: string): v is OrdersPreset => (ORDERS_PRESETS as string[]).includes(v);
const isStatus = (v: string): v is OrderStatus => (ORDER_STATUSES as readonly string[]).includes(v);
const isReason = (v: string): v is RejectionReason => (REJECTION_REASONS as readonly string[]).includes(v);

function isoDate(v: string | null): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function num(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseFiltersFromSearchParams(params: URLSearchParams): OrderListFilters {
  const presetRaw = params.get("preset") ?? "all";
  const preset = isPreset(presetRaw) ? presetRaw : "all";

  const statusRaw = params.get("status");
  const statuses = statusRaw
    ? statusRaw
        .split(",")
        .map((s) => s.trim())
        .filter(isStatus)
    : [];

  const agentRaw = params.get("agent_id");
  let agentId: OrderListFilters["agentId"] = null;
  if (agentRaw === "unassigned") agentId = "unassigned";
  else if (agentRaw) agentId = agentRaw;

  const reasonRaw = params.get("rejection_reason");
  const rejectionReason = reasonRaw && isReason(reasonRaw) ? reasonRaw : null;

  return {
    preset,
    marketId: params.get("market_id") || null,
    q: params.get("q") ?? "",
    statuses,
    agentId,
    dateFrom: isoDate(params.get("date_from")),
    dateTo: isoDate(params.get("date_to")),
    productId: params.get("product_id") || null,
    city: params.get("city") ?? "",
    totalMin: num(params.get("total_min")),
    totalMax: num(params.get("total_max")),
    rejectionReason,
    carrierId: params.get("carrier_id") || null,
  };
}

/** Serialize filters to a URLSearchParams fit for the browser address bar. */
export function filtersToSearchParams(filters: OrderListFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.preset !== "all") p.set("preset", filters.preset);
  if (filters.marketId) p.set("market_id", filters.marketId);
  if (filters.q) p.set("q", filters.q);
  if (filters.statuses.length > 0) p.set("status", filters.statuses.join(","));
  if (filters.agentId) p.set("agent_id", filters.agentId);
  if (filters.dateFrom) p.set("date_from", filters.dateFrom);
  if (filters.dateTo) p.set("date_to", filters.dateTo);
  if (filters.productId) p.set("product_id", filters.productId);
  if (filters.city) p.set("city", filters.city);
  if (filters.totalMin != null) p.set("total_min", String(filters.totalMin));
  if (filters.totalMax != null) p.set("total_max", String(filters.totalMax));
  if (filters.rejectionReason) p.set("rejection_reason", filters.rejectionReason);
  if (filters.carrierId) p.set("carrier_id", filters.carrierId);
  return p;
}

/** True if any filter beyond the default "all" preset + market is active. */
export function hasActiveFilters(filters: OrderListFilters): boolean {
  return (
    filters.preset !== "all" ||
    filters.q.length > 0 ||
    filters.statuses.length > 0 ||
    filters.agentId !== null ||
    filters.dateFrom !== null ||
    filters.dateTo !== null ||
    filters.productId !== null ||
    filters.city.length > 0 ||
    filters.totalMin !== null ||
    filters.totalMax !== null ||
    filters.rejectionReason !== null ||
    filters.carrierId !== null
  );
}

/** Return filters with a single named field cleared. Does not touch market/preset. */
export type ClearableFilterKey =
  | "q"
  | "statuses"
  | "agentId"
  | "date"
  | "productId"
  | "city"
  | "totalRange"
  | "rejectionReason"
  | "carrierId"
  | "preset";

export function clearFilterField(filters: OrderListFilters, key: ClearableFilterKey): OrderListFilters {
  switch (key) {
    case "q": return { ...filters, q: "" };
    case "statuses": return { ...filters, statuses: [] };
    case "agentId": return { ...filters, agentId: null };
    case "date": return { ...filters, dateFrom: null, dateTo: null };
    case "productId": return { ...filters, productId: null };
    case "city": return { ...filters, city: "" };
    case "totalRange": return { ...filters, totalMin: null, totalMax: null };
    case "rejectionReason": return { ...filters, rejectionReason: null };
    case "carrierId": return { ...filters, carrierId: null };
    case "preset": return { ...filters, preset: "all" };
  }
}

/** Reset all filters but preserve marketId (super_admin's current market pick). */
export function resetFilters(current: OrderListFilters): OrderListFilters {
  return { ...DEFAULT_FILTERS, marketId: current.marketId };
}

// ---------- API-side Zod schema (used by /api/orders/list) ----------

export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  preset: z.enum(["all", "unassigned", "callbacks", "today"]).default("all"),
  market_id: z.string().uuid().optional(),
  q: z.string().optional(),
  status: z.string().optional(), // csv
  agent_id: z.string().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  product_id: z.string().uuid().optional(),
  city: z.string().optional(),
  total_min: z.coerce.number().optional(),
  total_max: z.coerce.number().optional(),
  rejection_reason: z.enum(REJECTION_REASONS).optional(),
  carrier_id: z.string().uuid().optional(),
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

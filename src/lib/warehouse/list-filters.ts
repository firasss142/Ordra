import { z } from "zod";

export type WarehouseHistoryKind = "all" | "print" | "scan" | "return" | "adjust" | "writeoff";

export const WAREHOUSE_HISTORY_KINDS: WarehouseHistoryKind[] = [
  "all",
  "print",
  "scan",
  "return",
  "adjust",
  "writeoff",
];

export type WarehouseHistoryView = "timeline" | "flat";

export interface WarehouseHistoryFilters {
  kind: WarehouseHistoryKind;
  dateFrom: string | null;
  dateTo: string | null;
  q: string;
  actorId: string | null;
  productId: string | null;
  onlyAnomalies: boolean;
  view: WarehouseHistoryView;
}

export const DEFAULT_WAREHOUSE_HISTORY_FILTERS: WarehouseHistoryFilters = {
  kind: "all",
  dateFrom: null,
  dateTo: null,
  q: "",
  actorId: null,
  productId: null,
  onlyAnomalies: false,
  view: "timeline",
};

const isKind = (v: string): v is WarehouseHistoryKind =>
  (WAREHOUSE_HISTORY_KINDS as string[]).includes(v);

function isoDate(v: string | null): string | null {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function isUuid(v: string | null): string | null {
  if (!v) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

export function parseWarehouseHistoryFilters(
  params: URLSearchParams,
): WarehouseHistoryFilters {
  const kindRaw = params.get("kind") ?? "all";
  const viewRaw = params.get("view") ?? "timeline";
  return {
    kind: isKind(kindRaw) ? kindRaw : "all",
    dateFrom: isoDate(params.get("date_from")),
    dateTo: isoDate(params.get("date_to")),
    q: params.get("q") ?? "",
    actorId: isUuid(params.get("actor_id")),
    productId: isUuid(params.get("product_id")),
    onlyAnomalies: params.get("anomalies") === "1",
    view: viewRaw === "flat" ? "flat" : "timeline",
  };
}

export function warehouseHistoryFiltersToSearchParams(
  filters: WarehouseHistoryFilters,
): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.kind !== "all") p.set("kind", filters.kind);
  if (filters.dateFrom) p.set("date_from", filters.dateFrom);
  if (filters.dateTo) p.set("date_to", filters.dateTo);
  if (filters.q) p.set("q", filters.q);
  if (filters.actorId) p.set("actor_id", filters.actorId);
  if (filters.productId) p.set("product_id", filters.productId);
  if (filters.onlyAnomalies) p.set("anomalies", "1");
  if (filters.view !== "timeline") p.set("view", filters.view);
  return p;
}

export function hasActiveWarehouseHistoryFilters(
  filters: WarehouseHistoryFilters,
): boolean {
  return (
    filters.kind !== "all" ||
    filters.dateFrom !== null ||
    filters.dateTo !== null ||
    filters.q.length > 0 ||
    filters.actorId !== null ||
    filters.productId !== null ||
    filters.onlyAnomalies
  );
}

export type WarehouseHistoryClearableKey = "kind" | "date" | "q" | "actor" | "product" | "anomalies";

export function clearWarehouseHistoryField(
  filters: WarehouseHistoryFilters,
  key: WarehouseHistoryClearableKey,
): WarehouseHistoryFilters {
  switch (key) {
    case "kind":
      return { ...filters, kind: "all" };
    case "date":
      return { ...filters, dateFrom: null, dateTo: null };
    case "q":
      return { ...filters, q: "" };
    case "actor":
      return { ...filters, actorId: null };
    case "product":
      return { ...filters, productId: null };
    case "anomalies":
      return { ...filters, onlyAnomalies: false };
  }
}

// ---------- API-side Zod schema ----------

export const warehouseHistoryQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  kind: z.enum(["all", "print", "scan", "return", "adjust", "writeoff"]).default("all"),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().optional(),
  actor_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  anomalies: z.enum(["0", "1"]).optional(),
});

export type WarehouseHistoryQuery = z.infer<typeof warehouseHistoryQuerySchema>;

// ---------- Keyset cursor helpers ----------

export type WarehouseHistoryKindCursor = "print" | "scan";

export interface WarehouseHistoryCursor {
  createdAt: string;
  kind: WarehouseHistoryKindCursor;
  id: string;
}

export function encodeWarehouseHistoryCursor(
  c: WarehouseHistoryCursor,
): string {
  return Buffer.from(`${c.createdAt}|${c.kind}|${c.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeWarehouseHistoryCursor(
  raw: string,
): WarehouseHistoryCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const parts = decoded.split("|");
    if (parts.length !== 3) return null;
    const [createdAt, kind, id] = parts;
    if (!/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || !id) return null;
    if (kind !== "print" && kind !== "scan") return null;
    return { createdAt, kind, id };
  } catch {
    return null;
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { minutesBetween } from "@/lib/format";

const UNASSIGNED_OVERFLOW_MINUTES = 120;
const DISPATCH_FAILURE_HOURS = 72;
const CARRIER_STALE_DAYS = 7;
const RETURN_BOTTLENECK_THRESHOLD = 5;
const AGENT_INACTIVE_MINUTES = 120;
const ITEMS_PER_QUERY = 50;

export type AlertType =
  | "dispatch_failure"
  | "carrier_webhook_stale"
  | "overdue_callback"
  | "unassigned_overflow"
  | "return_bottleneck"
  | "low_stock"
  | "stock_depleted"
  | "agent_inactive";

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  entity_id: string;
  entity_kind: "order" | "product" | "agent";
  href: string;
  primary: string;
  secondary: string | null;
  meta: { key: string; value: number };
  created_at: string;
  market_id: string | null;
  acknowledged_at: string | null;
  actor_id: string | null;
  snoozed_until: string | null;
}

export interface AlertsSummary {
  total: number;
  by_severity: Record<AlertSeverity, number>;
  by_type: Record<AlertType, number>;
  alerts: Alert[];
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const ALERT_TYPE_TO_SEVERITY: Record<AlertType, AlertSeverity> = {
  dispatch_failure: "critical",
  carrier_webhook_stale: "critical",
  stock_depleted: "high",
  overdue_callback: "high",
  unassigned_overflow: "medium",
  return_bottleneck: "medium",
  low_stock: "low",
  agent_inactive: "low",
};

function alertKey(type: AlertType, entityId: string): string {
  return `${type}:${entityId}`;
}


interface OrderRow {
  id: string;
  market_id: string;
  customer_name: string | null;
  product_name: string | null;
  callback_scheduled_at?: string | null;
  created_at?: string;
  updated_at?: string;
  status?: string;
}

interface ProductRow {
  id: string;
  market_id: string;
  name: string;
  current_stock: number;
  low_stock_threshold: number;
}

interface UserRow {
  id: string;
  full_name: string | null;
  market_id: string | null;
  last_seen_at: string | null;
}

interface AckRow {
  alert_key: string;
  alert_type: string;
  entity_id: string;
  market_id: string | null;
  acknowledged_at: string | null;
  actor_id?: string | null;
  snoozed_until: string | null;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "super_admin" && role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const actorMarketId = actor.market_id ?? "";
  const marketId =
    role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actorMarketId;

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const overflowCutoffIso = new Date(now - UNASSIGNED_OVERFLOW_MINUTES * 60 * 1000).toISOString();
  const dispatchFailureCutoffIso = new Date(now - DISPATCH_FAILURE_HOURS * 60 * 60 * 1000).toISOString();
  const carrierStaleCutoffIso = new Date(now - CARRIER_STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const agentInactiveCutoffIso = new Date(now - AGENT_INACTIVE_MINUTES * 60 * 1000).toISOString();

  let q1 = supabase
    .from("orders")
    .select("id, market_id, customer_name, product_name, callback_scheduled_at, updated_at")
    .eq("status", "callback_scheduled")
    .lt("callback_scheduled_at", nowIso)
    .order("callback_scheduled_at", { ascending: true })
    .limit(ITEMS_PER_QUERY);
  if (marketId) q1 = q1.eq("market_id", marketId);

  let q2 = supabase
    .from("orders")
    .select("id, market_id, customer_name, product_name, created_at")
    .eq("status", "new")
    .is("assigned_to", null)
    .lt("created_at", overflowCutoffIso)
    .order("created_at", { ascending: true })
    .limit(ITEMS_PER_QUERY);
  if (marketId) q2 = q2.eq("market_id", marketId);

  let q3 = supabase
    .from("orders")
    .select("id, market_id, customer_name, product_name, status, updated_at")
    .in("status", ["confirmed", "scanned"])
    .lt("updated_at", dispatchFailureCutoffIso)
    .order("updated_at", { ascending: true })
    .limit(ITEMS_PER_QUERY);
  if (marketId) q3 = q3.eq("market_id", marketId);

  let q4 = supabase
    .from("orders")
    .select("id, market_id, customer_name, product_name, status, updated_at")
    .eq("status", "in_transit")
    .lt("updated_at", carrierStaleCutoffIso)
    .order("updated_at", { ascending: true })
    .limit(ITEMS_PER_QUERY);
  if (marketId) q4 = q4.eq("market_id", marketId);

  let q5 = supabase
    .from("orders")
    .select("id, market_id", { count: "exact" })
    .eq("status", "to_be_returned");
  if (marketId) q5 = q5.eq("market_id", marketId);

  let q6 = supabase
    .from("products")
    .select("id, market_id, name, current_stock, low_stock_threshold")
    .eq("is_active", true)
    .gt("low_stock_threshold", 0)
    .order("current_stock", { ascending: true })
    .limit(100);
  if (marketId) q6 = q6.eq("market_id", marketId);

  let q7 = supabase
    .from("users")
    .select("id, full_name, market_id, last_seen_at")
    .eq("role", "agent")
    .eq("is_active", true)
    .lt("last_seen_at", agentInactiveCutoffIso)
    .limit(100);
  if (marketId) q7 = q7.eq("market_id", marketId);

  let q8 = supabase
    .from("alert_acknowledgements")
    .select("alert_key, alert_type, entity_id, market_id, acknowledged_at, actor_id, snoozed_until");
  if (marketId) q8 = q8.eq("market_id", marketId);

  const [
    overdueRes,
    unassignedRes,
    dispatchStuckRes,
    carrierStaleRes,
    returnBottleneckRes,
    lowStockRes,
    inactiveAgentsRes,
    acksRes,
  ] = await Promise.all([q1, q2, q3, q4, q5, q6, q7, q8]);

  const queryErrors = {
    overdue: overdueRes.error,
    unassigned: unassignedRes.error,
    dispatchStuck: dispatchStuckRes.error,
    carrierStale: carrierStaleRes.error,
    returnBottleneck: returnBottleneckRes.error,
    lowStock: lowStockRes.error,
    inactiveAgents: inactiveAgentsRes.error,
    acks: acksRes.error,
  };
  const failed = Object.entries(queryErrors).filter(([, err]) => err);
  if (failed.length > 0) {
    console.error("[alerts/summary] query failures:", failed.map(([k, e]) => ({ query: k, error: e })));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const ackByKey = new Map<string, AckRow>();
  const ackRows = (acksRes.data ?? []) as AckRow[];
  for (const a of ackRows) {
    ackByKey.set(a.alert_key, a);
  }

  const alerts: Alert[] = [];

  const pushAlert = (a: Omit<Alert, "severity" | "acknowledged_at" | "actor_id" | "snoozed_until">) => {
    const key = a.id;
    const ack = ackByKey.get(key);
    if (ack?.acknowledged_at) return;
    if (ack?.snoozed_until && new Date(ack.snoozed_until).getTime() > now) return;
    alerts.push({
      ...a,
      severity: ALERT_TYPE_TO_SEVERITY[a.type],
      acknowledged_at: null,
      actor_id: null,
      snoozed_until: null,
    });
  };

  for (const o of (overdueRes.data ?? []) as OrderRow[]) {
    const overdueMin = minutesBetween(o.callback_scheduled_at!, now);
    pushAlert({
      id: alertKey("overdue_callback", o.id),
      type: "overdue_callback",
      entity_id: o.id,
      entity_kind: "order",
      href: `/orders/${o.id}`,
      primary: o.customer_name ?? "",
      secondary: o.product_name ?? null,
      meta: { key: "overdue_minutes", value: overdueMin },
      created_at: o.callback_scheduled_at!,
      market_id: o.market_id,
    });
  }

  for (const o of (unassignedRes.data ?? []) as OrderRow[]) {
    const ageMin = minutesBetween(o.created_at!, now);
    pushAlert({
      id: alertKey("unassigned_overflow", o.id),
      type: "unassigned_overflow",
      entity_id: o.id,
      entity_kind: "order",
      href: `/orders/${o.id}`,
      primary: o.customer_name ?? "",
      secondary: o.product_name ?? null,
      meta: { key: "age_minutes", value: ageMin },
      created_at: o.created_at!,
      market_id: o.market_id,
    });
  }

  for (const o of (dispatchStuckRes.data ?? []) as OrderRow[]) {
    const stuckHours = Math.floor((now - new Date(o.updated_at!).getTime()) / (60 * 60 * 1000));
    pushAlert({
      id: alertKey("dispatch_failure", o.id),
      type: "dispatch_failure",
      entity_id: o.id,
      entity_kind: "order",
      href: `/orders/${o.id}`,
      primary: o.customer_name ?? "",
      secondary: o.product_name ?? null,
      meta: { key: "stuck_hours", value: stuckHours },
      created_at: o.updated_at!,
      market_id: o.market_id,
    });
  }

  if (role === "super_admin") {
    for (const o of (carrierStaleRes.data ?? []) as OrderRow[]) {
      const stuckDays = Math.floor((now - new Date(o.updated_at!).getTime()) / (24 * 60 * 60 * 1000));
      pushAlert({
        id: alertKey("carrier_webhook_stale", o.id),
        type: "carrier_webhook_stale",
        entity_id: o.id,
        entity_kind: "order",
        href: `/orders/${o.id}`,
        primary: o.customer_name ?? "",
        secondary: o.product_name ?? null,
        meta: { key: "stuck_days", value: stuckDays },
        created_at: o.updated_at!,
        market_id: o.market_id,
      });
    }
  }

  const returnCount = returnBottleneckRes.count ?? 0;
  if (returnCount >= RETURN_BOTTLENECK_THRESHOLD) {
    const scopeId = marketId || "all";
    pushAlert({
      id: alertKey("return_bottleneck", scopeId),
      type: "return_bottleneck",
      entity_id: scopeId,
      entity_kind: "order",
      href: `/orders?status=to_be_returned`,
      primary: "",
      secondary: null,
      meta: { key: "pending_returns", value: returnCount },
      created_at: nowIso,
      market_id: marketId || null,
    });
  }

  for (const p of (lowStockRes.data ?? []) as ProductRow[]) {
    if (p.current_stock > p.low_stock_threshold) continue;
    const depleted = p.current_stock <= 0;
    pushAlert({
      id: alertKey(depleted ? "stock_depleted" : "low_stock", p.id),
      type: depleted ? "stock_depleted" : "low_stock",
      entity_id: p.id,
      entity_kind: "product",
      href: `/products/${p.id}`,
      primary: p.name,
      secondary: null,
      meta: { key: depleted ? "current_stock" : "remaining", value: p.current_stock },
      created_at: nowIso,
      market_id: p.market_id,
    });
  }

  for (const u of (inactiveAgentsRes.data ?? []) as UserRow[]) {
    if (!u.last_seen_at) continue;
    const inactiveMin = minutesBetween(u.last_seen_at, now);
    pushAlert({
      id: alertKey("agent_inactive", u.id),
      type: "agent_inactive",
      entity_id: u.id,
      entity_kind: "agent",
      href: `/team`,
      primary: u.full_name ?? "",
      secondary: null,
      meta: { key: "inactive_minutes", value: inactiveMin },
      created_at: u.last_seen_at,
      market_id: u.market_id,
    });
  }

  alerts.sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const by_severity: Record<AlertSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const by_type: Record<AlertType, number> = {
    dispatch_failure: 0,
    carrier_webhook_stale: 0,
    overdue_callback: 0,
    unassigned_overflow: 0,
    return_bottleneck: 0,
    low_stock: 0,
    stock_depleted: 0,
    agent_inactive: 0,
  };
  for (const a of alerts) {
    by_severity[a.severity] += 1;
    by_type[a.type] += 1;
  }

  const body: AlertsSummary = {
    total: alerts.length,
    by_severity,
    by_type,
    alerts,
  };

  return NextResponse.json(body);
}

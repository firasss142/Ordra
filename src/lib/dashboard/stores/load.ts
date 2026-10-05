// Accueil — reads the facts for one request (SERVER ONLY).
//
// get_store_dashboard for the window and the period before (the arrows); for
// the owner, get_product_cohort on both too — the per-product costs of
// Produits & marges, so the profit here is computed by the same rules.

import { marketToday } from "@/lib/products/period";
import { localDay, type CohortLine } from "@/lib/products/cohort";
import { normalizeCohortPayload } from "@/lib/products/overview";
import type { CohortCosts } from "@/lib/calculations/product-cohort";
import { localMinute, normalizeStoreOrders } from "./facts";
import { resolveDashWindow, type DashState } from "./period";
import type { BuildInput, StoreRow } from "./build";

interface Client {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

export class LoadError extends Error {}

type Payload = {
  stores?: StoreRow[];
  daily?: { storefront_id: string; day: string; n: number }[];
  ads?: { day: string; amount: number | string }[];
  avg_delivery_cost?: number | string | null;
  first_order_at?: string | null;
};

export async function loadStoreDash(
  supabase: Client,
  marketId: string,
  tz: string,
  state: DashState,
  owner: boolean,
  now: Date = new Date(),
): Promise<BuildInput> {
  const today = marketToday(tz, now);
  const w0 = resolveDashWindow(state.period, state.from, state.to, today, "2000-01-01");
  const rpc = (from: string, to: string) =>
    supabase.rpc("get_store_dashboard", { p_market_id: marketId, p_from: from, p_to: to, p_tz: tz });
  const cohort = (from: string, to: string) =>
    owner
      ? supabase.rpc("get_product_cohort", { p_market_id: marketId, p_from: from, p_to: to, p_tz: tz, p_product_id: null })
      : Promise.resolve({ data: null, error: null });

  const [aRes, pRes, marketRes, prodRes, caRes, cpRes, logoRes] = await Promise.all([
    rpc(w0.from, w0.to),
    rpc(w0.pf, w0.pt),
    supabase.from("markets").select("currency").eq("id", marketId).maybeSingle(),
    supabase
      .from("products")
      .select("id, name, unit_cogs, packing_cost, confirmation_processing_cost")
      .eq("market_id", marketId),
    cohort(w0.from, w0.to),
    cohort(w0.pf, w0.pt),
    supabase.from("storefronts").select("id, logo_url").eq("market_id", marketId),
  ]);
  const err = aRes.error ?? pRes.error ?? prodRes.error ?? caRes.error ?? cpRes.error;
  if (err) throw new LoadError(String((err as { message?: string }).message ?? err));

  const a = (aRes.data ?? {}) as Payload;
  // A missing logo is cosmetic: the card falls back to the initials, so a failed read is not an error.
  const logos = new Map(((logoRes.data ?? []) as { id: string; logo_url: string | null }[]).map((r) => [r.id, r.logo_url]));
  const first = a.first_order_at ? localDay(a.first_order_at, tz) : today;
  const window = resolveDashWindow(state.period, state.from, state.to, today, first);
  const inWindow = (d: string) => d >= window.from && d <= window.to;

  const A = normalizeStoreOrders(aRes.data, tz).filter((o) => inWindow(o.day));
  const P = normalizeStoreOrders(pRes.data, tz);

  const daily = new Map<string, Map<string, number>>();
  for (const r of a.daily ?? []) {
    const m = daily.get(r.storefront_id) ?? new Map<string, number>();
    m.set(r.day, Number(r.n) || 0);
    daily.set(r.storefront_id, m);
  }
  const ads: Record<string, number> = {};
  for (const p of [a, pRes.data as Payload | null]) for (const r of p?.ads ?? []) ads[r.day] = Number(r.amount) || 0;

  const products = (prodRes.data ?? []) as {
    id: string;
    name: string;
    unit_cogs: number | null;
    packing_cost: number | null;
    confirmation_processing_cost: number | null;
  }[];
  const productNames = new Map(products.map((p) => [p.id, p.name]));

  let money: BuildInput["money"] = null;
  if (owner) {
    const costs: Record<string, CohortCosts> = {};
    for (const p of products) {
      costs[p.id] = {
        unit_cogs: Number(p.unit_cogs) || 0,
        packing_cost: Number(p.packing_cost) || 0,
        processing_cost: Number(p.confirmation_processing_cost) || 0,
      };
    }
    const lines = (raw: unknown): CohortLine[] => normalizeCohortPayload(raw).lines;
    const aIds = new Set(A.map((o) => o.id));
    money = {
      linesA: lines(caRes.data).filter((l) => aIds.has(l.order_id)),
      linesP: lines(cpRes.data),
      costs,
      avgDeliveryCost: a.avg_delivery_cost == null ? null : Number(a.avg_delivery_cost),
    };
  }

  return {
    role: owner ? "owner" : "manager",
    currency: (marketRes.data as { currency?: string } | null)?.currency ?? "TND",
    tz,
    now,
    today,
    nowMin: localMinute(now.toISOString(), tz),
    first,
    window,
    A,
    P,
    stores: (a.stores ?? []).map((s) => ({ ...s, logo_url: logos.get(s.id) ?? null, webhook_failure_count: Number(s.webhook_failure_count) || 0, sheet_failures: Number(s.sheet_failures) || 0 })),
    daily,
    ads,
    productNames,
    money,
    firstDayOf: (iso) => localDay(iso, tz),
  };
}

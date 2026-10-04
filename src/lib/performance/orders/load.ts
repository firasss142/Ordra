// Performance › Commandes — reads the facts for one request (SERVER ONLY).
//
// One RPC per window: A, the period before (for the arrows), and B's own
// dates when comparing with other dates. Everything else is computed by
// build.ts from those rows.

import { marketToday } from "@/lib/products/period";
import { localDay } from "@/lib/products/cohort";
import { normalizeOrders, type PerfOrder } from "./facts";
import { MAX_DAYS, daysLen, resolveWindow, shiftDays } from "./period";
import type { PerfState } from "./query";
import type { BuildInput } from "./build";
import type { AgentInfo, CatalogueProduct, SubLabel } from "./view";

interface Client {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

type Payload = {
  ads?: { day: string; amount: number | string }[];
  users?: { id: string; full_name: string | null; color: string | null; avatar_url: string | null }[];
  first_order_at?: string | null;
};

export class LoadError extends Error {}

export async function loadPerformance(
  supabase: Client,
  marketId: string,
  tz: string,
  state: PerfState,
  withMoney: boolean,
  now: Date = new Date(),
): Promise<BuildInput> {
  const today = marketToday(tz, now);
  // The first order is only known after the first read; resolve with no floor, then again.
  const w0 = resolveWindow(state.period, state.from, state.to, today, "2000-01-01");
  const rpc = (from: string, to: string) =>
    supabase.rpc("get_orders_performance", { p_market_id: marketId, p_from: from, p_to: to, p_tz: tz });

  let bRange: { from: string; to: string } | null = null;
  if (state.cmp?.kind === "d") {
    const to = state.cmp.to > today ? today : state.cmp.to;
    const from = daysLen(state.cmp.from, to) > MAX_DAYS ? shiftDays(to, -(MAX_DAYS - 1)) : state.cmp.from;
    if (from <= to) bRange = { from, to };
  }

  const [aRes, pRes, bRes, marketRes, catRes, sizeRes, subRes, storeRes] = await Promise.all([
    rpc(w0.from, w0.to),
    rpc(w0.pf, w0.pt),
    bRange ? rpc(bRange.from, bRange.to) : Promise.resolve({ data: null, error: null }),
    supabase.from("markets").select("currency").eq("id", marketId).maybeSingle(),
    supabase.from("products").select("id, name, image_url").eq("market_id", marketId).is("deleted_at", null),
    supabase.from("product_variants").select("id, product_id, label").eq("market_id", marketId).eq("kind", "attribute").eq("is_active", true),
    supabase
      .from("rejection_reason_configs")
      .select("key, label_fr, label_ar, short_fr, short_ar")
      .eq("market_id", marketId),
    state.store
      ? supabase.from("storefronts").select("id, name").eq("id", state.store).eq("market_id", marketId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const err = aRes.error ?? pRes.error ?? bRes.error ?? catRes.error;
  if (err) throw new LoadError(String((err as { message?: string }).message ?? err));

  const a = (aRes.data ?? {}) as Payload;
  const firstAt = a.first_order_at ?? (pRes.data as Payload | null)?.first_order_at ?? null;
  const first = firstAt ? localDay(firstAt, tz) : today;
  const window = resolveWindow(state.period, state.from, state.to, today, first);

  // ?boutique= narrows every list to one store (the card clicked on Accueil).
  const store = (storeRes.data as { id: string; name: string } | null) ?? null;
  const inStore = (o: PerfOrder) => !state.store || o.store === state.store;
  const inWindow = (o: PerfOrder) => o.day >= window.from && o.day <= window.to && inStore(o);
  const A = normalizeOrders(aRes.data, tz).filter(inWindow);
  const P = normalizeOrders(pRes.data, tz).filter(inStore);
  const Bd = bRange ? normalizeOrders(bRes.data, tz).filter(inStore) : null;

  const ads: Record<string, number> = {};
  for (const p of [a, pRes.data as Payload | null]) {
    for (const r of p?.ads ?? []) ads[r.day] = Number(r.amount) || 0;
  }

  const users = new Map<string, AgentInfo>();
  for (const p of [a, pRes.data as Payload | null, bRes.data as Payload | null]) {
    for (const u of p?.users ?? []) {
      users.set(u.id, { id: u.id, name: u.full_name?.trim() || "—", color: u.color ?? null, avatar: u.avatar_url ?? null });
    }
  }

  const sizes = new Map<string, { id: string; label: string }[]>();
  for (const v of (sizeRes.data ?? []) as { id: string; product_id: string; label: string }[]) {
    const arr = sizes.get(v.product_id) ?? [];
    arr.push({ id: v.id, label: v.label });
    sizes.set(v.product_id, arr);
  }
  const catalogue: CatalogueProduct[] = ((catRes.data ?? []) as { id: string; name: string; image_url: string | null }[]).map((p) => ({
    id: p.id,
    name: p.name,
    image: p.image_url ?? null,
    sizes: (sizes.get(p.id) ?? []).sort((x, y) => x.label.localeCompare(y.label)),
  }));

  const subLabels: Record<string, SubLabel> = {};
  for (const r of (subRes.data ?? []) as { key: string; label_fr: string; label_ar: string; short_fr: string | null; short_ar: string | null }[]) {
    subLabels[r.key] = { fr: r.label_fr, ar: r.label_ar, short_fr: r.short_fr, short_ar: r.short_ar };
  }

  return {
    state,
    today,
    first,
    currency: (marketRes.data as { currency?: string } | null)?.currency ?? "TND",
    window,
    A,
    P,
    Bd,
    ads,
    withMoney,
    catalogue,
    agents: [...users.values()].sort((x, y) => x.name.localeCompare(y.name)),
    subLabels,
    store: store ? { id: store.id, name: store.name } : null,
  };
}

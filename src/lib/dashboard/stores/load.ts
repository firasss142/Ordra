// Accueil — reads the facts for one request (SERVER ONLY).
//
// get_store_dashboard, unchanged. A multi-day window reads itself and the period before
// (the arrows). A day (« Aujourd'hui », « Hier ») reads ONE span: the day and the 28 days
// before it — yesterday's total, the 14-day sparkline, and the usual day (the same weekday
// over 4 weeks) all come from it.

import { marketToday } from "@/lib/products/period";
import { localDay } from "@/lib/products/cohort";
import { shiftDays } from "@/lib/performance/orders/period";
import { localMinute, normalizeStoreOrders } from "./facts";
import { isDayWindow, resolveDashWindow, type DashState } from "./period";
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
  const day = isDayWindow(w0);
  const rpc = (from: string, to: string) =>
    supabase.rpc("get_store_dashboard", { p_market_id: marketId, p_from: from, p_to: to, p_tz: tz });
  const none = Promise.resolve({ data: null, error: null });

  const [aRes, pRes, marketRes, prodRes, logoRes] = await Promise.all([
    day ? rpc(shiftDays(w0.from, -28), w0.to) : rpc(w0.from, w0.to),
    day ? none : rpc(w0.pf, w0.pt),
    supabase.from("markets").select("currency").eq("id", marketId).maybeSingle(),
    supabase.from("products").select("id, name").eq("market_id", marketId),
    supabase.from("storefronts").select("id, logo_url").eq("market_id", marketId),
  ]);
  const err = aRes.error ?? pRes.error ?? prodRes.error;
  if (err) throw new LoadError(String((err as { message?: string }).message ?? err));

  const a = (aRes.data ?? {}) as Payload;
  // A missing logo is cosmetic: the card falls back to the initials, so a failed read is not an error.
  const logos = new Map(((logoRes.data ?? []) as { id: string; logo_url: string | null }[]).map((r) => [r.id, r.logo_url]));
  const first = a.first_order_at ? localDay(a.first_order_at, tz) : today;
  const window = resolveDashWindow(state.period, state.from, state.to, today, first);
  const inWindow = (d: string) => d >= window.from && d <= window.to;

  const read = normalizeStoreOrders(aRes.data, tz);
  const A = read.filter((o) => inWindow(o.day));
  const H = day ? read.filter((o) => o.day < window.from) : [];
  const P = day ? [] : normalizeStoreOrders(pRes.data, tz);

  const daily = new Map<string, Map<string, number>>();
  for (const r of a.daily ?? []) {
    const m = daily.get(r.storefront_id) ?? new Map<string, number>();
    m.set(r.day, Number(r.n) || 0);
    daily.set(r.storefront_id, m);
  }
  const ads: Record<string, number> = {};
  for (const p of [a, pRes.data as Payload | null]) for (const r of p?.ads ?? []) ads[r.day] = Number(r.amount) || 0;

  const products = (prodRes.data ?? []) as { id: string; name: string }[];

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
    H,
    stores: (a.stores ?? []).map((s) => ({
      ...s,
      logo_url: logos.get(s.id) ?? null,
      webhook_failure_count: Number(s.webhook_failure_count) || 0,
      sheet_failures: Number(s.sheet_failures) || 0,
    })),
    daily,
    ads,
    productNames: new Map(products.map((p) => [p.id, p.name])),
    firstDayOf: (iso) => localDay(iso, tz),
  };
}

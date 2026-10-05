/**
 * Loader for Finances › Investisseurs. Reads the investor engine's tables for
 * one market — deals and their terms in force, the per-deal snapshot series,
 * statements and paid withdrawals — and hands them to the pure model.
 * Callers have already checked canViewInvestorAdmin and scoped the market.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { todayInMarket } from "@/lib/dates/market-day";
import { buildInvestorsView, type Cadence, type InvestorsInput, type InvestorsView } from "./model";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

export interface InvestorsPageData extends InvestorsView {
  today: string;
}

export async function loadInvestorsPage(admin: Supa, marketId: string): Promise<InvestorsPageData> {
  const today = todayInMarket(marketId);

  const [usersRes, deals] = await Promise.all([
    admin.from("users").select("id, full_name").eq("role", "investor").eq("market_id", marketId).is("deleted_at", null).order("full_name"),
    fetchAllRows<{ id: string; investor_id: string; status: "active" | "matured" | "closed"; start_date: string; end_date: string; products: { name: string; image_url: string | null } | null }>(
      admin.from("investor_deals").select("id, investor_id, status, start_date, end_date, products(name, image_url)").eq("market_id", marketId).order("start_date").order("id"),
    ),
  ]);
  if (usersRes.error) throw new Error(usersRes.error.message);
  const users = (usersRes.data ?? []) as { id: string; full_name: string | null }[];
  const ids = users.map((u) => u.id);
  const dealIds = deals.map((d) => d.id);

  const [profiles, terms, snaps, stmts, paid] = await Promise.all([
    ids.length ? admin.from("investors").select("id, legal_name, payout_method").in("id", ids) : Promise.resolve({ data: [] }),
    dealIds.length
      ? fetchAllRows<{ deal_id: string; effective_from: string; share_pct: number | string; capital_amount: number | string; payout_cadence: Cadence }>(
          admin.from("investor_deal_terms").select("deal_id, effective_from, share_pct, capital_amount, payout_cadence").in("deal_id", dealIds).order("deal_id").order("effective_from"),
        )
      : Promise.resolve([]),
    dealIds.length ? admin.from("investor_deal_snapshots").select("deal_id, series").in("deal_id", dealIds) : Promise.resolve({ data: [] }),
    dealIds.length
      ? fetchAllRows<{ deal_id: string; period_end: string; investor_share: number | string; settled_at: string }>(
          admin.from("investor_deal_statements").select("deal_id, period_end, investor_share, settled_at").in("deal_id", dealIds).order("deal_id").order("period_end"),
        )
      : Promise.resolve([]),
    ids.length
      ? fetchAllRows<{ investor_id: string; amount: number | string; paid_at: string | null }>(
          admin.from("investor_withdrawals").select("investor_id, amount, paid_at").in("investor_id", ids).eq("status", "paid").order("paid_at"),
        )
      : Promise.resolve([]),
  ]);

  const profileBy = new Map(((profiles.data ?? []) as { id: string; legal_name: string | null; payout_method: string | null }[]).map((p) => [p.id, p]));
  // the terms in force today: the latest version already effective, else the first one
  const termsBy = new Map<string, (typeof terms)[number]>();
  for (const t of terms) {
    const cur = termsBy.get(t.deal_id);
    if (!cur || (t.effective_from <= today && t.effective_from > cur.effective_from)) termsBy.set(t.deal_id, t);
  }

  const input: InvestorsInput = {
    today,
    investors: users.map((u) => ({
      id: u.id,
      name: profileBy.get(u.id)?.legal_name || u.full_name || "—",
      method: profileBy.get(u.id)?.payout_method ?? null,
    })),
    deals: deals
      .filter((d) => termsBy.has(d.id))
      .map((d) => {
        const t = termsBy.get(d.id)!;
        return {
          id: d.id,
          investorId: d.investor_id,
          productName: d.products?.name ?? "—",
          productImage: d.products?.image_url ?? null,
          status: d.status,
          start: d.start_date,
          end: d.end_date,
          sharePct: Number(t.share_pct),
          capital: Number(t.capital_amount),
          cadence: t.payout_cadence,
        };
      }),
    series: ((snaps.data ?? []) as { deal_id: string; series: unknown }[]).map((s) => ({
      dealId: s.deal_id,
      days: (Array.isArray(s.series) ? (s.series as Record<string, unknown>[]) : []).map((r) => ({ d: String(r.d ?? ""), share: Number(r.share ?? 0), net: Number(r.net ?? 0) })),
    })),
    statements: stmts.map((s) => ({ dealId: s.deal_id, periodEnd: s.period_end, share: Number(s.investor_share), settledAt: s.settled_at })),
    withdrawals: paid.filter((w) => w.paid_at).map((w) => ({ investorId: w.investor_id, amount: Number(w.amount), paidAt: w.paid_at! })),
  };

  return { ...buildInvestorsView(input), today };
}

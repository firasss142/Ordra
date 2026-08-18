import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { fromMillimes, toMillimes } from "@/lib/calculations/math";
import type { DaySeriesRow, Waterfall } from "./accrual";
import { foldLedgerByCurrency, type LedgerBalance, type LedgerEntryLike } from "./ledger-fold";
import type { DealRow, TermsRow } from "./load-accrual";
import { termsRowToVersion } from "./load-accrual";
import { currentTerms, type TermsVersion } from "./terms";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

/**
 * Investor portfolio assembly — reads snapshots + ledger + statements and
 * produces the payloads the portal renders. No money is recomputed here: the
 * accrual lives in the snapshot (rollup) and the balance is the ledger fold.
 * Cross-currency totals are NEVER produced; everything is grouped by currency.
 */

export interface SnapshotRow {
  deal_id: string;
  as_of: string;
  facts_watermark: string | null;
  cumulative_share: string | number;
  unsettled_share: string | number;
  payable_now: string | number;
  carried_loss_before: string | number;
  carried_loss_after: string | number;
  restatement_delta: string | number;
  totals: Waterfall & { perUnit?: Record<string, number | null> };
  yours: Waterfall;
  series: DaySeriesRow[];
  pending: { count: number; revenueGross: number };
  in_flight: { count: number; expectedRevenue: number; expectedShare: number };
  rates: { confirmed: number | null; delivered: number | null; returned: number | null };
  counts: Record<string, number>;
  excluded: Record<string, number>;
  terms_current: Partial<TermsVersion>;
}

export interface StatementLite {
  id: string;
  deal_id: string;
  sequence_no: number;
  kind: string;
  period_start: string;
  period_end: string;
  net_profit: number;
  investor_share: number;
  payable: number;
  carried_loss_after: number;
  restatement_delta: number;
  settled_at: string;
  currency: string;
}

export interface DealCard {
  id: string;
  label: string | null;
  status: string;
  product_id: string;
  product_name: string | null;
  image_url: string | null;
  market_id: string;
  currency: string;
  start_date: string;
  end_date: string;
  days_elapsed: number;
  days_total: number;
  terms: TermsVersion | null;
  cumulative_share: number;
  settled_payable: number; // Σ statements.payable
  unsettled_share: number;
  payable_now: number;
  carried_loss_after: number;
  counts: Record<string, number>;
  rates: SnapshotRow["rates"];
  in_flight: SnapshotRow["in_flight"];
  pending: SnapshotRow["pending"];
  excluded: Record<string, number>;
  spark: number[]; // cumulative share series (last 30 points)
  as_of: string | null;
  statements_count: number;
  last_statement_end: string | null;
}

export interface CurrencySummary {
  currency: string;
  capital_outstanding: number;
  capital_invested: number;
  capital_returned: number;
  settled_lifetime: number;
  corrections: number;
  withdrawn: number;
  available: number;
  open_claims: number;
  available_for_request: number;
  unsettled_payable: number;
  position_value: number;
  total_earned: number;
  return_pct: number | null;
  first_start_date: string | null;
  next_maturity: string | null;
  series: { d: string; value: number }[];
}

export interface PortfolioPayload {
  as_of: string | null;
  investor: { id: string; legal_name: string | null; market_id: string | null; currency: string | null; payout_method: string | null };
  by_currency: Record<string, CurrencySummary>;
  deals: DealCard[];
  unread_notifications: number;
}

const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000));

export async function loadInvestorDeals(admin: Supa, investorId: string): Promise<{
  deals: (DealRow & { products: { name: string | null; image_url: string | null } | null })[];
  terms: Map<string, TermsVersion[]>;
  snapshots: Map<string, SnapshotRow>;
  statements: StatementLite[];
}> {
  const deals = await fetchAllRows<DealRow & { products: { name: string | null; image_url: string | null } | null }>(
    admin
      .from("investor_deals")
      .select("id, investor_id, product_id, market_id, currency, label, start_date, end_date, status, close_reason, closed_at, products(name, image_url)")
      .eq("investor_id", investorId)
      .order("start_date", { ascending: true }),
  );
  const ids = deals.map((d) => d.id);
  if (!ids.length) return { deals: [], terms: new Map(), snapshots: new Map(), statements: [] };
  const [termsRows, snaps, stmts] = await Promise.all([
    fetchAllRows<TermsRow>(admin.from("investor_deal_terms").select("id, deal_id, effective_from, share_pct, capital_amount, payout_cadence, maturity_date").in("deal_id", ids).order("effective_from", { ascending: true })),
    fetchAllRows<SnapshotRow>(admin.from("investor_deal_snapshots").select("*").in("deal_id", ids)),
    fetchAllRows<StatementLite>(
      admin
        .from("investor_deal_statements")
        .select("id, deal_id, sequence_no, kind, period_start, period_end, net_profit, investor_share, payable, carried_loss_after, restatement_delta, settled_at, currency")
        .in("deal_id", ids)
        .order("period_end", { ascending: true }),
    ),
  ]);
  const terms = new Map<string, TermsVersion[]>();
  for (const t of termsRows) (terms.get(t.deal_id) ?? terms.set(t.deal_id, []).get(t.deal_id)!).push(termsRowToVersion(t));
  const snapshots = new Map(snaps.map((s) => [s.deal_id, s]));
  return { deals, terms, snapshots, statements: stmts.map((s) => ({ ...s, net_profit: Number(s.net_profit), investor_share: Number(s.investor_share), payable: Number(s.payable), carried_loss_after: Number(s.carried_loss_after), restatement_delta: Number(s.restatement_delta) })) };
}

export function buildDealCard(
  deal: DealRow & { products: { name: string | null; image_url: string | null } | null },
  terms: TermsVersion[],
  snap: SnapshotRow | undefined,
  statements: StatementLite[],
  todayDate: string,
): DealCard {
  const series = snap?.series ?? [];
  const settled = statements.reduce((a, s) => a + toMillimes(s.payable), 0);
  const last = statements.length ? statements[statements.length - 1] : null;
  const total = daysBetween(deal.start_date, deal.end_date);
  const elapsed = Math.min(total, daysBetween(deal.start_date, todayDate));
  return {
    id: deal.id,
    label: deal.label,
    status: deal.status,
    product_id: deal.product_id,
    product_name: deal.products?.name ?? null,
    image_url: deal.products?.image_url ?? null,
    market_id: deal.market_id,
    currency: deal.currency,
    start_date: deal.start_date,
    end_date: deal.end_date,
    days_elapsed: elapsed,
    days_total: total,
    terms: currentTerms(terms),
    cumulative_share: Number(snap?.cumulative_share ?? 0),
    settled_payable: fromMillimes(settled),
    unsettled_share: Number(snap?.unsettled_share ?? 0),
    payable_now: Number(snap?.payable_now ?? 0),
    carried_loss_after: Number(snap?.carried_loss_after ?? 0),
    counts: snap?.counts ?? {},
    rates: snap?.rates ?? { confirmed: null, delivered: null, returned: null },
    in_flight: snap?.in_flight ?? { count: 0, expectedRevenue: 0, expectedShare: 0 },
    pending: snap?.pending ?? { count: 0, revenueGross: 0 },
    excluded: snap?.excluded ?? {},
    spark: series.slice(-30).map((r) => r.cum),
    as_of: snap?.as_of ?? null,
    statements_count: statements.length,
    last_statement_end: last?.period_end ?? null,
  };
}

/**
 * Per-day "value" of a deal on the payout basis (hero-consistent):
 *   settled payables of statements whose period_end <= d
 * + max(0, cum(d) − cumAtLastStatementEnd(d) − carriedLossAfter(lastStatement))
 */
export function dealValueSeries(snap: SnapshotRow | undefined, statements: StatementLite[]): { d: string; value: number }[] {
  const series = snap?.series ?? [];
  const sorted = [...statements].sort((a, b) => (a.period_end < b.period_end ? -1 : 1));
  const out: { d: string; value: number }[] = [];
  const cumAt = new Map(series.map((r) => [r.d, toMillimes(r.cum)]));
  for (const r of series) {
    let settled = 0;
    let lastEnd: string | null = null;
    let carried = 0;
    for (const s of sorted) {
      if (s.period_end <= r.d) {
        settled += toMillimes(s.payable);
        lastEnd = s.period_end;
        carried = toMillimes(s.carried_loss_after);
      }
    }
    const base = lastEnd ? (cumAt.get(lastEnd) ?? 0) : 0;
    const unsettled = Math.max(0, toMillimes(r.cum) - base - carried);
    out.push({ d: r.d, value: fromMillimes(settled + unsettled) });
  }
  return out;
}

export async function loadInvestorPortfolio(admin: Supa, investorId: string, todayDate: string): Promise<PortfolioPayload> {
  const [{ deals, terms, snapshots, statements }, ledger, claims, unread, profile] = await Promise.all([
    loadInvestorDeals(admin, investorId),
    fetchAllRows<LedgerEntryLike & { deal_id: string | null }>(admin.from("investor_ledger_entries").select("entry_type, amount, currency, deal_id").eq("investor_id", investorId)),
    fetchAllRows<{ amount: string | number; currency: string }>(admin.from("investor_withdrawals").select("amount, currency").eq("investor_id", investorId).in("status", ["requested", "approved"])),
    admin.from("investor_notifications").select("id", { count: "exact", head: true }).eq("investor_id", investorId).is("read_at", null),
    admin.from("investors").select("id, legal_name, payout_method").eq("id", investorId).maybeSingle(),
  ]);
  const userRow = await admin.from("users").select("market_id, markets(currency)").eq("id", investorId).maybeSingle();

  const cards = deals.map((d) => buildDealCard(d, terms.get(d.id) ?? [], snapshots.get(d.id), statements.filter((s) => s.deal_id === d.id), todayDate));
  const folds: Map<string, LedgerBalance> = foldLedgerByCurrency(ledger);
  const claimsBy = new Map<string, number>();
  for (const c of claims) claimsBy.set(c.currency, (claimsBy.get(c.currency) ?? 0) + toMillimes(Number(c.amount)));

  const currencies = new Set<string>([...folds.keys(), ...cards.map((c) => c.currency)]);
  const by_currency: Record<string, CurrencySummary> = {};
  let asOf: string | null = null;
  for (const cur of currencies) {
    const f = folds.get(cur) ?? { capitalInvested: 0, capitalReturned: 0, capitalOutstanding: 0, settledLifetime: 0, corrections: 0, withdrawn: 0, available: 0 };
    const curCards = cards.filter((c) => c.currency === cur);
    const unsettledPayable = curCards.reduce((a, c) => a + toMillimes(c.payable_now), 0);
    const openClaims = claimsBy.get(cur) ?? 0;
    // Value series: capital outstanding (constant today) + Σ deal value series aligned by day.
    const perDeal = curCards.map((c) => dealValueSeries(snapshots.get(c.id), statements.filter((s) => s.deal_id === c.id)));
    const days = new Set<string>();
    for (const s of perDeal) for (const p of s) days.add(p.d);
    const sortedDays = [...days].sort();
    const series = sortedDays.map((d) => {
      let v = toMillimes(f.capitalOutstanding);
      for (const s of perDeal) {
        // last known value at or before d
        let last = 0;
        for (const p of s) {
          if (p.d <= d) last = toMillimes(p.value);
          else break;
        }
        v += last;
      }
      return { d, value: fromMillimes(v) };
    });
    for (const c of curCards) if (c.as_of && (!asOf || c.as_of > asOf)) asOf = c.as_of;
    const totalEarned = toMillimes(f.settledLifetime) + toMillimes(f.corrections) + unsettledPayable;
    by_currency[cur] = {
      currency: cur,
      capital_outstanding: f.capitalOutstanding,
      capital_invested: f.capitalInvested,
      capital_returned: f.capitalReturned,
      settled_lifetime: f.settledLifetime,
      corrections: f.corrections,
      withdrawn: f.withdrawn,
      available: f.available,
      open_claims: fromMillimes(openClaims),
      available_for_request: fromMillimes(Math.max(0, toMillimes(f.available) - openClaims)),
      unsettled_payable: fromMillimes(unsettledPayable),
      position_value: fromMillimes(toMillimes(f.capitalOutstanding) + toMillimes(f.available) + toMillimes(f.withdrawn) + unsettledPayable),
      total_earned: fromMillimes(totalEarned),
      return_pct: f.capitalInvested > 0 ? Math.round((totalEarned / toMillimes(f.capitalInvested)) * 10000) / 100 : null,
      first_start_date: curCards.length ? curCards.map((c) => c.start_date).sort()[0] : null,
      next_maturity: curCards.filter((c) => c.status !== "closed").map((c) => c.end_date).sort()[0] ?? null,
      series,
    };
  }

  type ProfileRow = { id: string; legal_name: string | null; payout_method: string | null };
  type UserRow = { market_id: string | null; markets: { currency: string | null } | null };
  const p = (profile.data ?? null) as unknown as ProfileRow | null;
  const u = (userRow.data ?? null) as unknown as UserRow | null;

  return {
    as_of: asOf,
    investor: {
      id: investorId,
      legal_name: p?.legal_name ?? null,
      market_id: u?.market_id ?? null,
      currency: u?.markets?.currency ?? null,
      payout_method: p?.payout_method ?? null,
    },
    by_currency,
    deals: cards,
    unread_notifications: unread.count ?? 0,
  };
}

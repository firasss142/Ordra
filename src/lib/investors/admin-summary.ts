import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { toMillimes, fromMillimes } from "@/lib/calculations/math";
import { foldLedgerByCurrency, type LedgerEntryLike } from "./ledger-fold";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

export interface InvestorMoneySummary {
  deals_total: number;
  deals_active: number;
  by_currency: Record<string, { capital_outstanding: number; settled_lifetime: number; withdrawn: number; corrections: number; available: number; open_claims: number; unsettled_payable: number }>;
  last_statement_at: string | null;
}

/** Per-investor money summary for the admin Investisseurs tab. */
export async function loadInvestorMoneySummaries(admin: Supa, investorIds: string[]): Promise<Map<string, InvestorMoneySummary>> {
  const out = new Map<string, InvestorMoneySummary>();
  if (!investorIds.length) return out;
  const [ledger, deals, claims, stmts, snaps] = await Promise.all([
    fetchAllRows<LedgerEntryLike & { investor_id: string }>(admin.from("investor_ledger_entries").select("investor_id, entry_type, amount, currency").in("investor_id", investorIds)),
    fetchAllRows<{ id: string; investor_id: string; status: string; currency: string }>(admin.from("investor_deals").select("id, investor_id, status, currency").in("investor_id", investorIds)),
    fetchAllRows<{ investor_id: string; amount: string | number; currency: string }>(admin.from("investor_withdrawals").select("investor_id, amount, currency").in("investor_id", investorIds).in("status", ["requested", "approved"])),
    fetchAllRows<{ investor_id: string; settled_at: string }>(admin.from("investor_deal_statements").select("investor_id, settled_at").in("investor_id", investorIds).order("settled_at", { ascending: false })),
    fetchAllRows<{ deal_id: string; payable_now: string | number }>(admin.from("investor_deal_snapshots").select("deal_id, payable_now")),
  ]);
  const snapByDeal = new Map(snaps.map((s) => [s.deal_id, Number(s.payable_now)]));
  for (const id of investorIds) {
    const myLedger = ledger.filter((l) => l.investor_id === id);
    const myDeals = deals.filter((d) => d.investor_id === id);
    const folds = foldLedgerByCurrency(myLedger);
    const by: InvestorMoneySummary["by_currency"] = {};
    const curs = new Set<string>([...folds.keys(), ...myDeals.map((d) => d.currency)]);
    for (const c of curs) {
      const f = folds.get(c);
      const open = claims.filter((x) => x.investor_id === id && x.currency === c).reduce((a, x) => a + toMillimes(Number(x.amount)), 0);
      const unsettled = myDeals.filter((d) => d.currency === c && d.status !== "closed").reduce((a, d) => a + toMillimes(snapByDeal.get(d.id) ?? 0), 0);
      by[c] = {
        capital_outstanding: f?.capitalOutstanding ?? 0,
        settled_lifetime: f?.settledLifetime ?? 0,
        withdrawn: f?.withdrawn ?? 0,
        corrections: f?.corrections ?? 0,
        available: f?.available ?? 0,
        open_claims: fromMillimes(open),
        unsettled_payable: fromMillimes(unsettled),
      };
    }
    out.set(id, {
      deals_total: myDeals.length,
      deals_active: myDeals.filter((d) => d.status !== "closed").length,
      by_currency: by,
      last_statement_at: stmts.find((s) => s.investor_id === id)?.settled_at ?? null,
    });
  }
  return out;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { computeDealAccrualLive, loadDealTerms, loadPriorStatements, type DealRow } from "./load-accrual";
import { buildStatementDraft, derivePeriodStart, validatePeriodEnd, type StatementDraft, type StatementKind } from "./settlement";
import { todayFor } from "./admin-route";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

export interface PreviewResult {
  drafts: (StatementDraft & { investor_id: string; currency: string; product_name: string | null; image_url: string | null; investor_name: string | null; error?: string })[];
}

/** Recompute the draft for each deal at `periodEnd` — used by preview AND by commit (which then compares hashes). */
export async function previewSettlements(admin: Supa, dealIds: string[], periodEnd: string, kind: StatementKind = "periodic"): Promise<PreviewResult> {
  const deals = await fetchAllRows<DealRow & { products: { name: string | null; image_url: string | null } | null; investors: { legal_name: string | null } | null }>(
    admin.from("investor_deals").select("id, investor_id, product_id, market_id, currency, label, start_date, end_date, status, close_reason, closed_at, products(name, image_url), investors(legal_name)").in("id", dealIds),
  );
  const drafts: PreviewResult["drafts"] = [];
  for (const deal of deals) {
    const today = todayFor(deal.market_id);
    const prior = await loadPriorStatements(admin, deal.id);
    const periodStart = derivePeriodStart(deal, prior);
    const bad = validatePeriodEnd({ deal, periodStart, periodEnd, todayDate: today, kind });
    const base = { investor_id: deal.investor_id, currency: deal.currency, product_name: deal.products?.name ?? null, image_url: deal.products?.image_url ?? null, investor_name: deal.investors?.legal_name ?? null };
    if (deal.status === "closed") {
      drafts.push({ ...(await emptyDraft(admin, deal, periodEnd, kind)), ...base, error: "DEAL_CLOSED" });
      continue;
    }
    if (bad) {
      drafts.push({ ...(await emptyDraft(admin, deal, periodEnd, kind)), ...base, error: bad });
      continue;
    }
    const [live, terms] = await Promise.all([computeDealAccrualLive(admin, deal, periodEnd, today), loadDealTerms(admin, deal.id)]);
    const draft = buildStatementDraft({ deal, terms, accrual: live.result, prior, periodEnd, kind, factsWatermark: live.factsWatermark });
    drafts.push({ ...draft, ...base });
  }
  return { drafts };
}

async function emptyDraft(admin: Supa, deal: DealRow, periodEnd: string, kind: StatementKind): Promise<StatementDraft> {
  const prior = await loadPriorStatements(admin, deal.id);
  const today = todayFor(deal.market_id);
  const [live, terms] = await Promise.all([computeDealAccrualLive(admin, deal, periodEnd < deal.start_date ? deal.start_date : periodEnd, today), loadDealTerms(admin, deal.id)]);
  return buildStatementDraft({ deal, terms, accrual: live.result, prior, periodEnd, kind, factsWatermark: live.factsWatermark });
}

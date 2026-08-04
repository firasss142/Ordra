import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageInvestments } from "@/lib/investor-permissions";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { toMillimes, fromMillimes } from "@/lib/calculations/math";
import {
  computeSettlement,
  HOUSE_KEY,
  type PeriodProductTotals,
  type InvestorPositionsForProduct,
} from "@/lib/investors/settlement";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How long a reserve is held before it auto-releases.
 *
 * Long enough to cover the carrier return window, short enough that an
 * investor is not financing the business indefinitely.
 */
const RESERVE_HOLD_DAYS = 90;

/** ISO date N days after the given ISO date, in UTC. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface DailyRow {
  product_id: string;
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  processing_cost: number;
  ad_spend_direct: number;
  delivered_count: number;
  returned_count: number;
  confirmed_count: number;
}

/**
 * Closes a period and commits investor statements.
 *
 * Flow: aggregate the daily rollup for the period -> allocate market-wide ad
 * spend by revenue -> resolve each product's capital split -> compute each
 * investor's share -> commit atomically via apply_investor_settlement.
 *
 * `?dry_run=true` returns exactly what WOULD be written without writing it.
 * Settlement is the one irreversible operation in the system — the ledger is
 * append-only, so a wrong run cannot be edited away, only corrected forward.
 * Previewing first should be the norm.
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageInvestments(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const marketId = String(body.market_id ?? "");
  const periodStart = String(body.period_start ?? "");
  const periodEnd = String(body.period_end ?? "");
  const dryRun = body.dry_run === true || req.nextUrl.searchParams.get("dry_run") === "true";

  if (!marketId) {
    return NextResponse.json({ error: "market_id is required" }, { status: 400 });
  }
  if (!ISO_DATE.test(periodStart) || !ISO_DATE.test(periodEnd)) {
    return NextResponse.json({ error: "period dates must be YYYY-MM-DD" }, { status: 400 });
  }
  if (periodEnd < periodStart) {
    return NextResponse.json({ error: "period_end precedes period_start" }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    // ── Refuse to re-settle a period that is already closed ──────────────
    //
    // The rollup cron recomputes recent days idempotently, so a late carrier
    // event can change the daily stats underneath an already-settled period.
    // Re-running settlement then produces different numbers while the original
    // statements stay immutable. The unique constraint stops a double-pay, but
    // silently inserting nothing is a confusing way to find that out.
    const { count: settledCount } = await admin
      .from("investor_statements")
      .select("id", { count: "exact", head: true })
      .eq("market_id", marketId)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .in("status", ["settled", "paid"]);

    if (!dryRun && (settledCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error: "This period is already settled.",
          detail:
            `${settledCount} statement(s) exist for ${periodStart}..${periodEnd}. ` +
            "Post a correction instead — settlements are immutable.",
          settledStatements: settledCount,
        },
        { status: 409 }
      );
    }

    // ── Aggregate the rollup for the period ──────────────────────────────
    const daily = await fetchAllRows<DailyRow>(
      admin
        .from("investor_daily_product_stats")
        .select(
          "product_id, revenue, cogs, delivery_cost, return_cost, packing_cost, processing_cost, ad_spend_direct, delivered_count, returned_count, confirmed_count"
        )
        .eq("market_id", marketId)
        .gte("stat_date", periodStart)
        .lte("stat_date", periodEnd)
    );

    if (daily.length === 0) {
      return NextResponse.json(
        {
          error:
            "No rollup data for this period. Run /api/cron/investor-rollup for these dates first.",
        },
        { status: 422 }
      );
    }

    const totalsByProduct = new Map<string, PeriodProductTotals>();
    for (const row of daily) {
      const t =
        totalsByProduct.get(row.product_id) ??
        ({
          productId: row.product_id,
          revenue: 0,
          cogs: 0,
          deliveryCost: 0,
          returnCost: 0,
          packingCost: 0,
          processingCost: 0,
          adSpendDirect: 0,
          deliveredCount: 0,
          returnedCount: 0,
          confirmedCount: 0,
        } satisfies PeriodProductTotals);

      t.revenue = fromMillimes(toMillimes(t.revenue) + toMillimes(Number(row.revenue)));
      t.cogs = fromMillimes(toMillimes(t.cogs) + toMillimes(Number(row.cogs)));
      t.deliveryCost = fromMillimes(toMillimes(t.deliveryCost) + toMillimes(Number(row.delivery_cost)));
      t.returnCost = fromMillimes(toMillimes(t.returnCost) + toMillimes(Number(row.return_cost)));
      t.packingCost = fromMillimes(toMillimes(t.packingCost) + toMillimes(Number(row.packing_cost)));
      t.processingCost = fromMillimes(
        toMillimes(t.processingCost) + toMillimes(Number(row.processing_cost))
      );
      t.adSpendDirect = fromMillimes(
        toMillimes(t.adSpendDirect) + toMillimes(Number(row.ad_spend_direct))
      );
      t.deliveredCount += row.delivered_count;
      t.returnedCount += row.returned_count;
      t.confirmedCount += row.confirmed_count;

      totalsByProduct.set(row.product_id, t);
    }

    const products = [...totalsByProduct.values()];
    const productIds = products.map((p) => p.productId);

    // ── Market-wide ad spend for the period ──────────────────────────────
    const { data: marketAds } = await admin
      .from("ad_spend")
      .select("amount")
      .eq("market_id", marketId)
      .eq("is_active", true)
      .is("product_id", null)
      .lte("period_start", periodEnd)
      .gte("period_end", periodStart);

    const marketWideAdSpend = fromMillimes(
      (marketAds ?? []).reduce((acc, r) => acc + toMillimes(Number(r.amount)), 0)
    );

    // ── Capital positions, house included ────────────────────────────────
    const positionRows = await fetchAllRows<{
      product_id: string;
      investor_id: string | null;
      amount: number;
      effective_from: string;
      effective_to: string | null;
    }>(
      admin
        .from("investment_positions")
        .select("product_id, investor_id, amount, effective_from, effective_to")
        .in("product_id", productIds)
        // Scope by market as well as product. Without it, any position row
        // belonging to another market silently joins the totalCapital
        // denominator and dilutes every investor in this one.
        .eq("market_id", marketId)
    );

    const positions: InvestorPositionsForProduct[] = productIds.map((productId) => {
      const byHolder = new Map<string, { amount: number; effectiveFrom: string; effectiveTo: string | null }[]>();
      for (const row of positionRows.filter((r) => r.product_id === productId)) {
        const key = row.investor_id ?? HOUSE_KEY;
        const list = byHolder.get(key) ?? [];
        list.push({
          amount: Number(row.amount),
          effectiveFrom: row.effective_from,
          effectiveTo: row.effective_to,
        });
        byHolder.set(key, list);
      }
      return { productId, byHolder };
    });

    // ── Carried losses and reserve percentages ───────────────────────────
    const investorIds = [
      ...new Set(positionRows.map((r) => r.investor_id).filter((id): id is string => !!id)),
    ];

    const [{ data: investorRows }, priorStatements] = await Promise.all([
      investorIds.length > 0
        ? admin.from("investors").select("id, reserve_pct").in("id", investorIds)
        : Promise.resolve({ data: [] as { id: string; reserve_pct: number }[] }),
      investorIds.length > 0
        ? fetchAllRows<{
            investor_id: string;
            product_id: string;
            period_end: string;
            cost_inputs: Record<string, unknown> | null;
          }>(
            admin
              .from("investor_statements")
              .select("investor_id, product_id, cost_inputs, period_end")
              .in("investor_id", investorIds)
              .lt("period_end", periodStart)
              .order("period_end", { ascending: true })
          )
        : Promise.resolve([]),
    ]);

    const reservePct = new Map(
      (investorRows ?? []).map((r) => [r.id, Number(r.reserve_pct ?? 0)])
    );

    // The most recent prior statement carries the outstanding loss forward.
    //
    // This must NOT rely on iteration order. fetchAllRows pages with .range(),
    // and PostgREST only guarantees ordering within a page — so a stale
    // carried_loss_after from a later page could overwrite the current one and
    // pay out money that was never earned. Compare period_end explicitly and
    // keep the maximum per (investor, product).
    const latestPeriodEnd = new Map<string, string>();
    const carriedLosses = new Map<string, number>();
    for (const s of priorStatements) {
      const key = `${s.investor_id}:${s.product_id}`;
      const seen = latestPeriodEnd.get(key);
      if (seen !== undefined && s.period_end <= seen) continue;
      latestPeriodEnd.set(key, s.period_end);
      carriedLosses.set(key, Number(s.cost_inputs?.carried_loss_after ?? 0));
    }

    // ── Compute ──────────────────────────────────────────────────────────
    const result = computeSettlement({
      marketId,
      periodStart,
      periodEnd,
      products,
      marketWideAdSpend,
      positions,
      carriedLosses,
      reservePct,
      reserveReleaseAfter: addDays(periodEnd, RESERVE_HOLD_DAYS),
    });

    const totalPayable = fromMillimes(
      result.statements.reduce((acc, s) => acc + toMillimes(s.investor_share), 0)
    );

    // Reconciliation. computeSettlement returns netProfitByProduct explicitly
    // for this and it was previously discarded. Investor shares plus the house
    // share must equal the product's net profit; any gap means the capital
    // split or the allocation is wrong, and it is far cheaper to see it here
    // than after the money has moved.
    const reconciliation = [...result.netProfitByProduct.entries()].map(
      ([productId, netProfit]) => {
        const investorShare = result.statements
          .filter((s) => s.product_id === productId)
          .reduce((acc, s) => acc + toMillimes(s.investor_share + s.carried_loss_applied), 0);
        const housePct =
          100 -
          result.statements
            .filter((s) => s.product_id === productId)
            .reduce((acc, s) => acc + s.share_pct, 0);
        const houseShare = Math.round((toMillimes(netProfit) * housePct) / 100);
        return {
          productId,
          netProfit,
          allocated: fromMillimes(investorShare + houseShare),
          unallocated: fromMillimes(toMillimes(netProfit) - investorShare - houseShare),
        };
      }
    );

    // Any product whose allocation does not add back up to its net profit is
    // a bug in the capital split — surface it rather than paying it out.
    const unreconciled = reconciliation.filter((r) => Math.abs(r.unallocated) > 0.001);

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        period: { start: periodStart, end: periodEnd },
        marketWideAdSpend,
        productsSettled: products.length,
        statements: result.statements,
        ledgerEntries: result.ledger.length,
        totalPayable,
        reserveReleaseAfter: addDays(periodEnd, RESERVE_HOLD_DAYS),
        alreadySettled: (settledCount ?? 0) > 0,
        reconciliation,
        unreconciled,
      });
    }

    if (unreconciled.length > 0) {
      return NextResponse.json(
        {
          error: "Refusing to settle: allocations do not reconcile to net profit.",
          unreconciled,
        },
        { status: 422 }
      );
    }

    // ── Commit atomically ────────────────────────────────────────────────
    const { data: applied, error: rpcError } = await admin.rpc("apply_investor_settlement", {
      p_statements: result.statements,
      p_ledger: result.ledger,
      p_actor_id: actor.id,
    });

    if (rpcError) {
      console.error("[POST /api/admin/investments/settlements] rpc:", rpcError);
      return NextResponse.json({ error: "Settlement failed", detail: rpcError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      period: { start: periodStart, end: periodEnd },
      totalPayable,
      ...(applied as Record<string, unknown>),
    });
  } catch (err) {
    console.error("[POST /api/admin/investments/settlements]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

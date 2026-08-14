import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { getActor } from "@/lib/auth/actor";
import { isLockedForActor } from "@/lib/ad-spend/enforce-lock";

export const dynamic = "force-dynamic";

interface ImportRowInput {
  period_start: string;
  period_end: string;
  amount: number;
  product_id?: string | null;
  note?: string | null;
  /**
   * The campaign as the ad platform named it. This is the only identity a CSV
   * row carries that survives a re-export, so it is what a later reconciliation
   * against Meta or TikTok has to match on — a note written by a human will not
   * do. Optional because a hand-assembled row need not have one.
   */
  campaign_name?: string | null;
}

/** Exactly the column set this route writes. */
interface AdSpendInsert {
  market_id: string;
  created_by: string;
  amount: number;
  period_start: string;
  period_end: string;
  product_id: string | null;
  note: string | null;
  campaign_name: string | null;
  source: string;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canViewFinanceSection(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const rows = (body?.rows ?? []) as ImportRowInput[];
  const bodyMarketId = body?.market_id as string | undefined;

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows[] is required" }, { status: 400 });
  }

  const marketId =
    role === "super_admin" ? (bodyMarketId ?? actor.market_id ?? "") : (actor.market_id ?? "");
  if (!marketId) {
    return NextResponse.json({ error: "market_id required" }, { status: 400 });
  }

  const valid: AdSpendInsert[] = [];
  const rejected: Array<{ index: number; reason: string }> = [];

  rows.forEach((r, i) => {
    if (!r || typeof r !== "object") {
      rejected.push({ index: i, reason: "invalid_row" });
      return;
    }
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      rejected.push({ index: i, reason: "invalid_amount" });
      return;
    }
    if (!r.period_start || !r.period_end || r.period_start > r.period_end) {
      rejected.push({ index: i, reason: "invalid_period" });
      return;
    }
    // Same closed-period rule as single POST — imports must not bypass it.
    if (isLockedForActor(r.period_end, role, req)) {
      rejected.push({ index: i, reason: "locked_period" });
      return;
    }
    valid.push({
      market_id: marketId,
      created_by: actor.id,
      amount,
      period_start: r.period_start,
      period_end: r.period_end,
      product_id: r.product_id ?? null,
      note: r.note ?? null,
      campaign_name: r.campaign_name ?? null,
      // Stamping the provenance is what makes a later Meta sync safe: rows the
      // API owns can be reconciled or replaced, while rows a human pasted in
      // from a spreadsheet must be left exactly as they were typed.
      source: "csv",
    });
  });

  if (valid.length === 0) {
    return NextResponse.json(
      { error: "no_valid_rows", rejected },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.from("ad_spend").insert(valid).select();

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      inserted: data?.length ?? 0,
      rejected,
    },
  }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

interface ImportRowInput {
  period_start: string;
  period_end: string;
  amount: number;
  product_id?: string | null;
  note?: string | null;
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

  const valid: Array<ImportRowInput & { market_id: string; created_by: string }> = [];
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
    valid.push({
      market_id: marketId,
      created_by: actor.id,
      amount,
      period_start: r.period_start,
      period_end: r.period_end,
      product_id: r.product_id ?? null,
      note: r.note ?? null,
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

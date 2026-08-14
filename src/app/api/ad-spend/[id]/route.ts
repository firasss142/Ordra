import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { enforcePeriodLock } from "@/lib/ad-spend/enforce-lock";

export const dynamic = "force-dynamic";

interface AdSpendEntryRef {
  id: string;
  market_id: string;
  period_start: string;
  period_end: string;
}

type ResolvedEntry =
  | { kind: "err"; err: NextResponse }
  | {
      kind: "ok";
      supabase: Awaited<ReturnType<typeof createClient>>;
      role: string;
      entry: AdSpendEntryRef;
    };

async function resolveActorAndEntry(req: NextRequest, id: string): Promise<ResolvedEntry> {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) {
    return { kind: "err", err: actorResult.response as NextResponse };
  }
  const { actor } = actorResult;

  if (!canViewFinanceSection(actor.role)) {
    return { kind: "err", err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const { data: entry } = await supabase
    .from("ad_spend")
    .select("id, market_id, period_start, period_end")
    .eq("id", id)
    .single();

  if (!entry) {
    return { kind: "err", err: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }

  if (actor.role === "market_manager" && entry.market_id !== actor.market_id) {
    return { kind: "err", err: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { kind: "ok", supabase, role: actor.role, entry: entry as AdSpendEntryRef };
}

// PATCH: update entry fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const resolved = await resolveActorAndEntry(req, id);
  if (resolved.kind === "err") return resolved.err;
  const { supabase, role, entry } = resolved;

  const lockErr = enforcePeriodLock(entry.period_end, role, req);
  if (lockErr) return lockErr;

  const body = await req.json();
  const { amount, note, period_start, period_end } = body;

  const updates: Record<string, unknown> = {};
  if (amount !== undefined) {
    if (Number(amount) < 0) {
      return NextResponse.json({ error: "amount must be non-negative" }, { status: 400 });
    }
    updates.amount = Number(amount);
  }
  if (note !== undefined) updates.note = note;
  if (period_start !== undefined) updates.period_start = period_start;
  if (period_end !== undefined) updates.period_end = period_end;

  // product_id is genuinely tri-state here, which is why it cannot be read with
  // the `!== undefined` idiom used above: null is a *value* (the entry is
  // market-level spend, attributable to no single product), not an omission.
  // Presence of the key is therefore what decides whether the column is written
  // — an absent key must leave whatever attribution the entry already has.
  if (Object.prototype.hasOwnProperty.call(body, "product_id")) {
    // `|| null` rather than `?? null`: the modal can send an empty string, and
    // '' reaching a uuid column is a 500 where the caller meant "market-level".
    const nextProductId = (body.product_id as string | null | undefined) || null;

    // Market isolation is not free here. RLS on ad_spend gates the *entry* by
    // market, and the FK to products only proves the id exists — neither checks
    // that the product belongs to the same market. Without this, a manager could
    // attach their own market's spend to another market's product, where it is
    // then read by the product-profitability routes and by investor settlement.
    if (nextProductId !== null) {
      const { data: product } = await supabase
        .from("products")
        .select("market_id")
        .eq("id", nextProductId)
        .maybeSingle();

      if (!product || product.market_id !== entry.market_id) {
        return NextResponse.json(
          { error: "product_id must belong to the same market as the entry" },
          { status: 400 },
        );
      }
    }

    updates.product_id = nextProductId;
  }

  // Validate against the STORED values too, so a single-sided update
  // (only period_start or only period_end sent) can't invert the period.
  const resolvedStart = (updates.period_start as string | undefined) ?? entry.period_start;
  const resolvedEnd = (updates.period_end as string | undefined) ?? entry.period_end;
  if (resolvedStart > resolvedEnd) {
    return NextResponse.json({ error: "period_start must be before period_end" }, { status: 400 });
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ad_spend")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// DELETE: soft delete
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  const resolved = await resolveActorAndEntry(req, id);
  if (resolved.kind === "err") return resolved.err;
  const { supabase, role, entry } = resolved;

  const lockErr = enforcePeriodLock(entry.period_end, role, req);
  if (lockErr) return lockErr;

  const { data, error } = await supabase
    .from("ad_spend")
    .update({ is_active: false })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

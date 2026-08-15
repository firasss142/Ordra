import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

/**
 * The rate that converts an ad account's billing currency into the market's.
 *
 * Meta bills most accounts in USD while `ad_spend.amount` is dinars, and the
 * sync refuses to run without this rather than storing a USD figure at face
 * value — `$100` written as `100 LYD` understates spend about fivefold, which
 * is the exact direction that makes a losing campaign look profitable.
 *
 * The rate is stamped onto every row at sync time, so changing it here affects
 * what is synced next, never what was synced before. That is deliberate: a
 * historical spend figure should not move because someone updated a rate today.
 *
 * It lives in `settings` under `ad_spend_fx_rates` as `{"USD": 4.85}` — a map,
 * because one market can eventually carry accounts billed in more than one
 * currency. It gets a `settings_history` row like every other financial input.
 */

export const dynamic = "force-dynamic";

const KEY = "ad_spend_fx_rates";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId = req.nextUrl.searchParams.get("market_id");
  if (!marketId) {
    return NextResponse.json({ error: "market_id query parameter required" }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("settings")
    .select("value, updated_at")
    .eq("market_id", marketId)
    .eq("key", KEY)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({
    data: { rates: (data?.value ?? {}) as Record<string, number>, updated_at: data?.updated_at ?? null },
  });
}

export async function PUT(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const marketId: string | undefined = body.market_id;
  const currency: string | undefined =
    typeof body.currency === "string" ? body.currency.trim().toUpperCase() : undefined;
  const rate = Number(body.rate);

  if (!marketId || !currency) {
    return NextResponse.json({ error: "market_id and currency are required" }, { status: 400 });
  }
  // A zero or negative rate would silently zero out every future spend row, and
  // NaN would poison the column. Refuse rather than store.
  if (!Number.isFinite(rate) || rate <= 0) {
    return NextResponse.json(
      { error: "invalid_rate", message: "Rate must be a positive number." },
      { status: 400 },
    );
  }

  const adminClient = createAdminClient();

  const { data: existing } = await adminClient
    .from("settings")
    .select("value")
    .eq("market_id", marketId)
    .eq("key", KEY)
    .maybeSingle();

  const oldValue = (existing?.value ?? {}) as Record<string, number>;
  // Merged, not replaced: setting the USD rate must not delete a EUR rate a
  // second account depends on.
  const newValue = { ...oldValue, [currency]: rate };

  const { error } = await adminClient.from("settings").upsert(
    {
      market_id: marketId,
      key: KEY,
      value: newValue,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "market_id,key" },
  );

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  await adminClient.from("settings_history").insert({
    market_id: marketId,
    key: KEY,
    old_value: existing?.value ?? null,
    new_value: newValue,
    changed_by: actor.id,
  });

  return NextResponse.json({ data: { rates: newValue } });
}

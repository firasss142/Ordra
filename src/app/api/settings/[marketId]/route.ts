import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  canReadSettings,
  canWriteSettings,
} from "@/lib/settings-permissions";
import { DEFAULT_MARKET_SETTINGS, isValidMarketSettings } from "@/types/settings";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canReadSettings(role, marketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("settings")
    .select("key, value, updated_at")
    .eq("market_id", marketId);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canWriteSettings(role, marketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isValidMarketSettings(body)) {
    return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 });
  }

  const incoming = { ...(body as unknown as Record<string, unknown>) };
  const keys = Object.keys(incoming);

  const { data: existingRows } = await supabase
    .from("settings")
    .select("key, value")
    .eq("market_id", marketId)
    .in("key", keys);

  const existingByKey = new Map<string, unknown>(
    (existingRows ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value]),
  );

  // WhatsApp automation (Paramètres › WhatsApp) is a super_admin decision —
  // the screen is read-only for a market manager (prototypes/whatsapp-manager-v1.html).
  // The screen saves the WHOLE settings object, so a manager saving another
  // group sends these keys unchanged: those are dropped from the write; a
  // changed one is refused and nothing is written.
  if (role !== "super_admin") {
    const defaults = DEFAULT_MARKET_SETTINGS as unknown as Record<string, unknown>;
    for (const key of keys.filter((k) => k.startsWith("whatsapp_"))) {
      const stored = existingByKey.has(key) ? existingByKey.get(key) : { value: defaults[key] ?? null };
      const sent = { value: incoming[key] ?? null };
      if (JSON.stringify(stored) !== JSON.stringify(sent)) {
        return NextResponse.json({ error: "whatsapp_settings_super_admin_only" }, { status: 403 });
      }
      delete incoming[key];
    }
  }

  const updates = Object.entries(incoming).map(([key, value]) => {
    const wrapped =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? value
        : { value };
    return {
      market_id: marketId,
      key,
      value: wrapped,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase.from("settings").upsert(updates, {
    onConflict: "market_id,key",
  });

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const historyRows = updates
    .filter((u) => JSON.stringify(existingByKey.get(u.key)) !== JSON.stringify(u.value))
    .map((u) => ({
      market_id: marketId,
      key: u.key,
      old_value: existingByKey.get(u.key) ?? null,
      new_value: u.value,
      changed_by: actor.id,
    }));

  if (historyRows.length > 0) {
    await supabase.from("settings_history").insert(historyRows);
  }

  // Mirror the algorithm into assignment_rules.
  //
  // Two columns claim to be "the assignment algorithm" and they were allowed
  // to disagree: `settings.assignment_algorithm` drives the webhook runtime,
  // while `assignment_rules.algorithm` drives the /assign board's display and
  // its bulk button. This page only ever wrote the first, so the board could
  // show « Manuel » with its button greyed out while webhooks distributed by
  // some other rule.
  //
  // Worse, the board writes `is_active = false` whenever a manager picks
  // « Manuel » there, and `tryAutoAssign` returns early on `!is_active`. Once
  // that had happened, choosing an algorithm HERE did nothing at all, silently
  // and with no feedback anywhere. PUT /api/assignment-rules already mirrors
  // in the other direction; this closes the loop.
  const algorithm = incoming.assignment_algorithm;
  if (typeof algorithm === "string") {
    const { error: ruleErr } = await supabase.from("assignment_rules").upsert(
      {
        market_id: marketId,
        algorithm,
        // Choosing a real algorithm here is an instruction to run it.
        is_active: algorithm !== "manual",
      },
      { onConflict: "market_id" },
    );
    if (ruleErr) {
      // Not fatal — the settings themselves saved — but it means the two
      // surfaces are out of step again, which is exactly the bug above.
      console.error("[PATCH /api/settings/[marketId]] assignment_rules mirror failed", {
        code: ruleErr.code,
        message: ruleErr.message,
      });
    }
  }

  return NextResponse.json({ success: true });
}

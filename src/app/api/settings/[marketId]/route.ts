import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  canReadSettings,
  canWriteSettings,
} from "@/lib/settings-permissions";
import {
  DEFAULT_MARKET_SETTINGS,
  isValidMarketSettings,
  MARKET_SETTINGS_KEYS,
} from "@/types/settings";
import { assembleMarketSettings } from "@/lib/settings/assembleMarketSettings";
import { MANAGER_EDITABLE_SETTING_KEYS } from "@/lib/reglages/topics";

export const dynamic = "force-dynamic";

const KNOWN_KEYS = new Set<string>(MARKET_SETTINGS_KEYS);

/**
 * A stored row's plain value. Scalars are written as { value }, but older rows
 * carry { type } (assignment_algorithm) or { amount } (fees); a plain object
 * such as shift_config is stored as-is.
 */
function storedScalar(raw: unknown): unknown {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const ks = Object.keys(raw);
    if (ks.length === 1 && (ks[0] === "value" || ks[0] === "type" || ks[0] === "amount")) {
      return (raw as Record<string, unknown>)[ks[0]];
    }
  }
  return raw;
}

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
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 });
  }

  // Réglages sends only what changed (the save bar's edits); older callers
  // still send the whole object. Both are a set of keys to apply on top of
  // what is stored — validated as the full object they would produce.
  const incoming = { ...(body as Record<string, unknown>) };
  const keys = Object.keys(incoming);
  if (keys.some((k) => !KNOWN_KEYS.has(k))) {
    return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 });
  }

  const { data: existingRows } = await supabase
    .from("settings")
    .select("key, value")
    .eq("market_id", marketId);
  const rows = (existingRows ?? []) as { key: string; value: unknown }[];
  const existingByKey = new Map<string, unknown>(rows.map((r) => [r.key, r.value]));

  const merged = { ...assembleMarketSettings(rows), ...incoming };
  if (!isValidMarketSettings(merged)) {
    return NextResponse.json({ error: "Invalid settings payload" }, { status: 400 });
  }

  // Only what actually changes is written — re-sending a stored value (even one
  // stored in a legacy { type } / { amount } wrapper) writes nothing and leaves
  // no « manual → manual » row in the history.
  const defaults = DEFAULT_MARKET_SETTINGS as unknown as Record<string, unknown>;
  const changed = keys.filter((key) => {
    const stored = existingByKey.has(key) ? storedScalar(existingByKey.get(key)) : defaults[key];
    return JSON.stringify(stored ?? null) !== JSON.stringify(incoming[key] ?? null);
  });

  // A market manager runs the day-to-day rules of their own market; money,
  // stock planning and WhatsApp automation are the administrator's
  // (plans/reglages-redesign.md). RLS cannot restrict keys, so this does.
  if (role !== "super_admin") {
    const refused = changed.filter((k) => !MANAGER_EDITABLE_SETTING_KEYS.has(k));
    if (refused.length > 0) {
      const error = refused.every((k) => k.startsWith("whatsapp_"))
        ? "whatsapp_settings_super_admin_only"
        : "setting_super_admin_only";
      return NextResponse.json({ error }, { status: 403 });
    }
  }

  if (changed.length === 0) return NextResponse.json({ success: true });

  const updates = changed.map((key) => {
    const value = incoming[key];
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

  const { error: historyErr } = await supabase.from("settings_history").insert(
    updates.map((u) => ({
      market_id: marketId,
      key: u.key,
      old_value: existingByKey.get(u.key) ?? null,
      new_value: u.value,
      changed_by: actor.id,
    })),
  );
  if (historyErr) {
    console.error("[PATCH /api/settings/[marketId]] settings_history insert failed", {
      code: historyErr.code,
      message: historyErr.message,
    });
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
  const algorithm = changed.includes("assignment_algorithm") ? incoming.assignment_algorithm : undefined;
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

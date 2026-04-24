import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { parseAlertKey } from "@/app/api/alerts/alert-key";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "super_admin" && role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const alertKeys = body.alert_keys;
  if (!Array.isArray(alertKeys) || alertKeys.length === 0) {
    return NextResponse.json({ error: "Missing required field: alert_keys" }, { status: 400 });
  }

  const parsed: { key: string; type: string; entityId: string }[] = [];
  for (const k of alertKeys) {
    if (typeof k !== "string") {
      return NextResponse.json({ error: "alert_keys must be strings" }, { status: 400 });
    }
    const p = parseAlertKey(k);
    if (!p) {
      return NextResponse.json({ error: `Invalid alert_key: ${k}` }, { status: 400 });
    }
    parsed.push({ key: k, ...p });
  }

  const marketId =
    role === "super_admin"
      ? (typeof body.market_id === "string" ? body.market_id : null)
      : actor.market_id;

  const nowIso = new Date().toISOString();
  const rows = parsed.map((p) => ({
    alert_key: p.key,
    alert_type: p.type,
    entity_id: p.entityId,
    market_id: marketId,
    acknowledged_at: nowIso,
    snoozed_until: null,
    actor_id: actor.id,
    updated_at: nowIso,
  }));

  const { error } = await supabase
    .from("alert_acknowledgements")
    .upsert(rows, { onConflict: "market_id,alert_key" });

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ acknowledged: rows.length });
}

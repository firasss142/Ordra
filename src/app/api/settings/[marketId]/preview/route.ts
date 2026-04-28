import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canReadSettings } from "@/lib/settings-permissions";
import {
  previewMaxAttemptsChange,
  type PreviewOrder,
} from "@/lib/calculations/settings-preview";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ marketId: string }> },
) {
  const { marketId } = await params;
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const nextRaw = searchParams.get("value");

  if (key !== "max_call_attempts") {
    return NextResponse.json({ error: "Unsupported preview key" }, { status: 400 });
  }
  const next = Number(nextRaw);
  if (!Number.isInteger(next) || next < 1 || next > 10) {
    return NextResponse.json({ error: "Invalid value" }, { status: 400 });
  }

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canReadSettings(actor.role, marketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  const { data: currentRow } = await supabase
    .from("settings")
    .select("value")
    .eq("market_id", marketId)
    .eq("key", "max_call_attempts")
    .maybeSingle();

  const current =
    typeof (currentRow?.value as { value?: unknown })?.value === "number"
      ? ((currentRow?.value as { value: number }).value)
      : 3;

  const relevantStatuses = [
    "pending",
    "assigned",
    "attempt_1",
    "attempt_2",
    "attempt_3",
    "callback_scheduled",
    "rejected",
  ];

  const { data: orders, error } = await supabase
    .from("orders")
    .select("id, status, attempt_count")
    .eq("market_id", marketId)
    .in("status", relevantStatuses)
    .limit(5000);

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const preview = previewMaxAttemptsChange({
    current,
    next,
    orders: (orders ?? []) as PreviewOrder[],
  });

  return NextResponse.json({ current, next, ...preview });
}

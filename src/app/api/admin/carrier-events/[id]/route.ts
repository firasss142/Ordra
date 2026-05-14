import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const { data, error } = await supabase
    .from("carrier_event_log")
    .select(
      "id, carrier_code, source, tracking_number, carrier_status_raw, order_id, outcome, outcome_reason, raw_body, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ data });
}

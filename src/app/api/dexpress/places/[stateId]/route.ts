import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stateId: string }> }
) {
  const { stateId } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const parsedStateId = parseInt(stateId, 10);
  if (isNaN(parsedStateId)) {
    return NextResponse.json({ error: "Invalid stateId" }, { status: 400 });
  }

  const { data: places, error } = await supabase
    .from("dexpress_places")
    .select("id, name")
    .eq("state_id", parsedStateId)
    .eq("status", 1)
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ places: places ?? [] });
}

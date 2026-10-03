import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const { data: states, error } = await supabase
    .from("dexpress_states")
    .select("id, name")
    .eq("status", 1)
    .order("name");

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ states: states ?? [] });
}

export const GET = withRouteErrors("/api/dexpress/states", "GET", handleGET);

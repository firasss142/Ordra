import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageCarriers } from "@/lib/settings-permissions";
import { getActor } from "@/lib/auth/actor";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canManageCarriers(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: carrier } = await supabase
    .from("carriers")
    .select("id, market_id, api_endpoint")
    .eq("id", id)
    .single();

  if (!carrier) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (role !== "super_admin" && carrier.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(carrier.api_endpoint, {
      method: "HEAD",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    return NextResponse.json({ reachable: res.ok || res.status < 500, status: res.status });
  } catch {
    return NextResponse.json({ reachable: false, error: "Connection failed" });
  }
}

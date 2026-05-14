import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

const CAMPAIGNS_TABLE = "prospect_campaigns";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const queryMarketId = url.searchParams.get("market_id");

  let targetMarketId: string;
  if (actor.role === "super_admin") {
    if (!queryMarketId) {
      return NextResponse.json(
        { error: "market_id is required for super_admin" },
        { status: 400 }
      );
    }
    targetMarketId = queryMarketId;
  } else {
    if (!actor.market_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (queryMarketId && queryMarketId !== actor.market_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    targetMarketId = actor.market_id;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(CAMPAIGNS_TABLE)
    .select("*")
    .eq("market_id", targetMarketId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

interface CreateBody {
  market_id?: string;
  name?: string;
  filter_json?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { market_id, name, filter_json } = body;
  if (!market_id || !name) {
    return NextResponse.json(
      { error: "market_id and name are required" },
      { status: 400 }
    );
  }
  if (
    filter_json === undefined ||
    filter_json === null ||
    typeof filter_json !== "object" ||
    Array.isArray(filter_json)
  ) {
    return NextResponse.json(
      { error: "filter_json must be an object" },
      { status: 400 }
    );
  }

  if (
    actor.role === "market_manager" &&
    market_id !== actor.market_id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(CAMPAIGNS_TABLE)
    .insert({
      market_id,
      name,
      filter_json,
      created_by: actor.id,
    })
    .select()
    .single();

  if (error) {
    const status = /duplicate key|unique/i.test(error.message) ? 409 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json({ data }, { status: 201 });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  canReadSettings,
  canWriteSettings,
} from "@/lib/settings-permissions";
import { isValidMarketSettings } from "@/types/settings";

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

  const updates = Object.entries(body as unknown as Record<string, unknown>).map(
    ([key, value]) => {
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
    }
  );

  const { error } = await supabase.from("settings").upsert(updates, {
    onConflict: "market_id,key",
  });

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ success: true });
}

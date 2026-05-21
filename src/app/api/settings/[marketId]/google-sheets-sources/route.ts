import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canWriteSettings, canReadSettings } from "@/lib/settings-permissions";

export const dynamic = "force-dynamic";

interface SheetSource {
  storefront_id: string;
  spreadsheet_id: string;
  sheet_name: string;
  platform: string;
  is_active: boolean;
}

function isSheetSource(v: unknown): v is SheetSource {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.storefront_id === "string" &&
    typeof s.spreadsheet_id === "string" &&
    typeof s.sheet_name === "string" &&
    typeof s.platform === "string" &&
    typeof s.is_active === "boolean"
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response as NextResponse;
  const { actor } = actorResult;

  if (!canReadSettings(actor.role, marketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("settings")
    .select("value")
    .eq("market_id", marketId)
    .eq("key", "google_sheets_sources")
    .maybeSingle();

  const sources: SheetSource[] = Array.isArray(data?.value)
    ? (data.value as unknown[]).filter(isSheetSource)
    : [];

  return NextResponse.json({ data: sources });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  const { marketId } = await params;
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response as NextResponse;
  const { actor } = actorResult;

  if (!canWriteSettings(actor.role, marketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body) || !body.every(isSheetSource)) {
    return NextResponse.json({ error: "Invalid payload: expected array of sheet sources" }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("settings").upsert(
    {
      market_id: marketId,
      key: "google_sheets_sources",
      value: body,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "market_id,key" }
  );

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

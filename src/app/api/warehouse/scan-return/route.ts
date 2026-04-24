import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import {
  validateScanReturnBody,
  type ScanReturnInput,
} from "@/lib/warehouse/returns-validation";

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: ScanReturnInput;
  try {
    body = (await req.json()) as ScanReturnInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateScanReturnBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("scan_return_in", {
    p_order_id: parsed.data.order_id,
    p_actor_id: actor.id,
    p_is_damaged: parsed.data.is_damaged,
    p_return_reason: parsed.data.return_reason,
    p_return_photo_url: parsed.data.return_photo_url,
    p_return_reason_note: parsed.data.return_reason_note,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json(data ?? { success: true });
}

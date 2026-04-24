import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import type { ScanErrorCode } from "@/lib/preparation/tray-state";

function classifyRpcError(message: string): { code: ScanErrorCode; status: number } {
  const m = message.toLowerCase();
  if (m.includes("not found") && m.includes("order")) {
    return { code: "ORDER_NOT_FOUND", status: 409 };
  }
  if (m.includes("different market") || m.includes("market")) {
    return { code: "MARKET_MISMATCH", status: 409 };
  }
  if (m.includes("not in confirmed") || m.includes("current:")) {
    return { code: "INVALID_STATUS", status: 409 };
  }
  if (m.includes("label")) {
    return { code: "NO_LABEL_PRINTED", status: 409 };
  }
  if (m.includes("stock") && m.includes("zero")) {
    return { code: "STOCK_UNDERFLOW", status: 409 };
  }
  return { code: "ORDER_NOT_FOUND", status: 422 };
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { order_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = body.order_id?.trim();
  if (!orderId) {
    return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("scan_order_out", {
    p_order_id: orderId,
    p_actor_id: actor.id,
  });

  if (error) {
    const { code, status } = classifyRpcError(error.message);
    return NextResponse.json({ error_code: code, message: error.message }, { status });
  }

  return NextResponse.json(data ?? { success: true });
}

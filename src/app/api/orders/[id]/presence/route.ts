import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { LOCK_TTL_SECONDS } from "@/lib/orders/order-lock";

export const dynamic = "force-dynamic";

const ACTIONS = new Set(["acquire", "heartbeat", "release"]);
const MODES = new Set(["viewing", "editing"]);

/**
 * One route, one verb, three actions.
 *
 * POST-only and content-type-tolerant because `navigator.sendBeacon` — the only
 * thing that reliably fires on tab close — can only POST, and sends text/plain
 * unless handed a typed Blob. A DELETE route would simply be unreachable from
 * the one call that matters most for releasing a lock promptly.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  let body: Record<string, unknown>;
  try {
    // .json() rather than checking Content-Type: a beacon may arrive as
    // text/plain and the payload is still JSON.
    body = JSON.parse(await req.text()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const mode = typeof body.mode === "string" ? body.mode : undefined;

  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }
  if (mode !== undefined && !MODES.has(mode)) {
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  }

  const supabase = await createClient();

  if (action === "release") {
    const { error } = await supabase.rpc("release_order_presence", {
      p_order_id: id,
      p_session_id: sessionId,
    });
    if (error) return rpcError(error);
    return new NextResponse(null, { status: 204 });
  }

  const fn = action === "acquire" ? "acquire_order_presence" : "heartbeat_order_presence";
  const { data, error } = await supabase.rpc(fn, {
    p_order_id: id,
    p_session_id: sessionId,
    p_mode: mode ?? (action === "acquire" ? "viewing" : null),
    p_ttl_seconds: LOCK_TTL_SECONDS,
  });
  if (error) return rpcError(error);

  const result = (data ?? {}) as Record<string, unknown>;

  // A heartbeat that finds no live row means the lock expired or a super_admin
  // forced it. That is the belt to the broadcast's braces: the takeover screen
  // fires within one beat even when the socket is down.
  if (action === "heartbeat" && result.alive === false) {
    return NextResponse.json({ code: "lock_lost" }, { status: 409 });
  }

  return NextResponse.json({ data: result });
}

function rpcError(error: { code?: string | null; message?: string | null }) {
  if (error.code === "42501") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (error.code === "P0002") {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (error.code === "22023") {
    return NextResponse.json({ error: error.message ?? "Bad request" }, { status: 400 });
  }
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

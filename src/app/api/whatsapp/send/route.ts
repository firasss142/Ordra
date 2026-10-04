import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { sendMessage, SendError, type SendRequest } from "@/lib/whatsapp/send";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * POST /api/whatsapp/send — an agent or manager sends one message from the
 * business number. Synchronous: 201 with the log row, or the reason.
 *
 *   400 bad_request         · malformed body
 *   403 not_owner           · an agent on someone else's order or lead
 *   404 not_found           · the target is not visible to this user (RLS)
 *   409 <gate reason>       · config_inactive · invalid_phone · opted_out ·
 *                             undeliverable · window_closed · template_unavailable
 *   502 graph_failed        · Meta refused; `code` and `kind` say why
 */

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["agent", "market_manager", "super_admin"]);

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!ALLOWED_ROLES.has(actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as SendRequest | null;
  if (!body || typeof body !== "object" || !body.target) {
    return NextResponse.json({ error: "bad_request", message: "target is required" }, { status: 400 });
  }

  try {
    const message = await sendMessage({ admin: createAdminClient(), user: await createClient(), actor }, body);
    return NextResponse.json({ data: message }, { status: 201 });
  } catch (err) {
    if (err instanceof SendError) {
      return NextResponse.json(
        { error: err.code, message: err.message, code: err.graphCode, kind: err.kind },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withRouteErrors("/api/whatsapp/send", "POST", handlePOST);

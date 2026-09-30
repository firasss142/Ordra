import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { decrypt } from "@/lib/crypto";

/**
 * GET /api/whatsapp/config/[marketId]/verify-token — « Afficher » on the
 * Connexions card and in the webhook block.
 *
 * The verify token is what the operator pastes into the Meta app's webhook
 * form, so it has to be readable again after the save. It is the ONLY
 * credential that may ever come back to a browser, and only here:
 * super_admin only (a market_manager sees the card read-only), one market at
 * a time, never cached, and never next to the access token or the app
 * secret — those are selected nowhere in this route.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest, { params }: { params: { marketId: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }

  const { data, error } = await createAdminClient()
    .from("whatsapp_configs")
    .select("verify_token")
    .eq("market_id", params.marketId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500, headers: NO_STORE });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });

  let token: string;
  try {
    token = decrypt((data as { verify_token: string }).verify_token);
  } catch {
    return NextResponse.json(
      { error: "decrypt_failed", message: "Verify token illisible — ENCRYPTION_KEY a probablement changé. Saisissez-le à nouveau." },
      { status: 409, headers: NO_STORE },
    );
  }
  return NextResponse.json({ data: { verify_token: token } }, { headers: NO_STORE });
}

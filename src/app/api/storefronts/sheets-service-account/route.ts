import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { canManageStorefronts } from "@/lib/settings-permissions";
import { getServiceAccountEmail } from "@/lib/google-sheets/inspect-sheet";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * The Google account a sheet must be shared with before it can be connected.
 * Only the address — the key never leaves the server.
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (!canManageStorefronts(actorResult.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json({ email: getServiceAccountEmail() });
}

export const GET = withRouteErrors("/api/storefronts/sheets-service-account", "GET", handleGET);

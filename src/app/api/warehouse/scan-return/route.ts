import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import {
  validateScanReturnBody,
  type ScanReturnInput,
} from "@/lib/warehouse/returns-validation";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * The building refusals scan_return_in raises since 20261007100000, read from
 * DETAIL = {"code": ...} (PostgREST's `error.details`), never from the prose.
 * Both are "not yours to touch": 403, and the code lets the screen say which.
 */
const SITE_CODES = new Set(["NO_SITE_ASSIGNED", "WRONG_SITE"]);

function siteCode(details: unknown): string | null {
  if (typeof details !== "string") return null;
  try {
    const code = (JSON.parse(details) as { code?: unknown } | null)?.code;
    return typeof code === "string" && SITE_CODES.has(code) ? code : null;
  } catch {
    return null;
  }
}

async function handlePOST(req: NextRequest) {
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
    const code = siteCode((error as { details?: unknown }).details);
    if (code) {
      return NextResponse.json({ error: error.message, error_code: code }, { status: 403 });
    }
    return NextResponse.json({ error: error.message }, { status: 422 });
  }

  return NextResponse.json(data ?? { success: true });
}

export const POST = withRouteErrors("/api/warehouse/scan-return", "POST", handlePOST);

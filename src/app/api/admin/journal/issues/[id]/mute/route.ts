import { NextRequest, NextResponse } from "next/server";
import { journalSession, rpcFailure } from "@/lib/journal/guard";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/journal/issues/[id]/mute  { days: 1..90 } — « Ignorer 7 jours ».
 * The problem stays listed (greyed) and comes back on its own at the date, or
 * closes on its own if its cause goes away first.
 */
async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const s = await journalSession(req);
  if ("response" in s) return s.response;
  const body = (await req.json().catch(() => null)) as { days?: unknown } | null;
  const days = Number(body?.days);
  if (!UUID.test(params.id) || !Number.isInteger(days) || days < 1 || days > 90) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { error } = await s.supabase.rpc("journal_issue_mute", { p_issue_id: params.id, p_days: days });
  if (error) return rpcFailure(error);
  return NextResponse.json({ ok: true });
}

export const POST = withRouteErrors("/api/admin/journal/issues/[id]/mute", "POST", handlePOST);

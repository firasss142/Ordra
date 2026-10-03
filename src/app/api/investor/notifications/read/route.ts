import { NextRequest, NextResponse } from "next/server";
import { investorActor } from "@/lib/investors/investor-route";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/** Body: { ids?: string[] } — omit to mark all read. */
async function handlePOST(req: NextRequest) {
  const g = await investorActor(req);
  if ("response" in g) return g.response;
  let ids: string[] | null = null;
  try {
    const body = (await req.json()) as { ids?: unknown };
    if (Array.isArray(body.ids)) ids = body.ids.filter((x): x is string => typeof x === "string");
  } catch {
    ids = null;
  }
  const { data, error } = await g.admin.rpc("mark_investor_notifications_read", { p_investor_id: g.actor.id, p_ids: ids });
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  return NextResponse.json({ data: { marked: data ?? 0 } });
}

export const POST = withRouteErrors("/api/investor/notifications/read", "POST", handlePOST);

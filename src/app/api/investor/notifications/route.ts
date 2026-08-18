import { NextRequest, NextResponse } from "next/server";
import { investorActor, INVESTOR_CACHE } from "@/lib/investors/investor-route";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await investorActor(req);
  if ("response" in g) return g.response;
  const unreadOnly = req.nextUrl.searchParams.get("unread") === "1";
  let q = g.admin.from("investor_notifications").select("id, kind, deal_id, statement_id, withdrawal_id, payload, read_at, created_at").eq("investor_id", g.actor.id).order("created_at", { ascending: false }).limit(100);
  if (unreadOnly) q = q.is("read_at", null);
  const rows = await fetchAllRows(q);
  const unread = rows.filter((r) => (r as { read_at: string | null }).read_at === null).length;
  return NextResponse.json({ data: rows, unread }, { headers: INVESTOR_CACHE });
}

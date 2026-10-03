import { NextRequest, NextResponse } from "next/server";
import { journalSession, rpcFailure } from "@/lib/journal/guard";
import { withRouteErrors } from "@/lib/journal/route-errors";
import type { OrderMatch } from "@/lib/journal/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/journal/trace — « Retrouver une commande ».
 *   ?q=<order number | tracking number>  → { matches, trace } (trace when exactly one)
 *   ?order_id=<uuid>                     → { matches: [], trace }
 */
async function handleGET(req: NextRequest) {
  const s = await journalSession(req);
  if ("response" in s) return s.response;

  const orderId = req.nextUrl.searchParams.get("order_id");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();

  let matches: OrderMatch[] = [];
  let id: string | null = null;
  if (orderId) {
    if (!UUID.test(orderId)) return NextResponse.json({ error: "Invalid order_id" }, { status: 400 });
    id = orderId;
  } else {
    if (q.length < 3 || q.length > 80) return NextResponse.json({ error: "Invalid q" }, { status: 400 });
    const { data, error } = await s.supabase.rpc("journal_find_order", { p_q: q });
    if (error) return rpcFailure(error);
    matches = (data ?? []) as OrderMatch[];
    if (matches.length === 1) id = matches[0].id;
  }

  if (!id) return NextResponse.json({ matches, trace: null });
  const { data: trace, error } = await s.supabase.rpc("journal_order_trace", { p_order_id: id });
  if (error) return rpcFailure(error);
  return NextResponse.json({ matches, trace });
}

export const GET = withRouteErrors("/api/admin/journal/trace", "GET", handleGET);

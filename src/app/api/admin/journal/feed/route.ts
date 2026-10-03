import { NextRequest, NextResponse } from "next/server";
import { journalSession, rpcFailure } from "@/lib/journal/guard";
import { withRouteErrors } from "@/lib/journal/route-errors";
import type { FeedRow } from "@/lib/journal/types";

export const dynamic = "force-dynamic";

const FAMILIES = new Set(["ext", "team", "auto", "sec"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/;

/**
 * GET /api/admin/journal/feed — Historique, one stream.
 *   ?family=ext|team|auto|sec  ?only_issues=1  ?market=<uuid>
 *   ?before=<iso>&before_id=<row id>  (keyset: the last row of the previous page)
 *   ?limit=1..300  ?tz=<IANA zone, for the per-day routine count>
 * Returns { rows, next, routine } — routine passes counted per local day over
 * exactly the span this page covers, so pages add up.
 */
async function handleGET(req: NextRequest) {
  const s = await journalSession(req);
  if ("response" in s) return s.response;

  const q = req.nextUrl.searchParams;
  const family = q.get("family") || null;
  const market = q.get("market") || null;
  const before = q.get("before") || null;
  const beforeId = q.get("before_id") || null;
  const tz = q.get("tz") || "Africa/Tripoli";
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 150) || 150, 1), 300);

  if (family && !FAMILIES.has(family)) return bad("family");
  if (market && !UUID.test(market)) return bad("market");
  if (before && Number.isNaN(Date.parse(before))) return bad("before");
  if (!TZ.test(tz)) return bad("tz");

  const { data, error } = await s.supabase.rpc("journal_feed", {
    p_before: before,
    p_before_id: beforeId,
    p_limit: limit,
    p_family: family,
    p_only_issues: q.get("only_issues") === "1",
    p_market: market,
  });
  if (error) return rpcFailure(error);

  const rows = (data ?? []) as FeedRow[];
  const last = rows[rows.length - 1];
  const next = rows.length >= limit && last ? { before: last.at, beforeId: last.id } : null;

  const from = last ? last.at : new Date(Date.now() - 86_400_000).toISOString();
  const to = before ?? new Date().toISOString();
  const { data: routineRows } = await s.supabase.rpc("journal_routine", { p_from: from, p_to: to, p_tz: tz });
  const routine: Record<string, number> = {};
  for (const r of (routineRows ?? []) as { day: string; passes: number }[]) routine[r.day] = Number(r.passes);

  return NextResponse.json({ rows, next, routine });
}

function bad(field: string) {
  return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
}

export const GET = withRouteErrors("/api/admin/journal/feed", "GET", handleGET);

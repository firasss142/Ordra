import { NextRequest, NextResponse } from "next/server";
import { journalSession, rpcFailure } from "@/lib/journal/guard";
import { withRouteErrors } from "@/lib/journal/route-errors";
import type { Family } from "@/lib/journal/types";

export const dynamic = "force-dynamic";

const FAMILIES: Family[] = ["team", "ext", "auto", "sec"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TZ = /^[A-Za-z_]+(\/[A-Za-z_+-]+){0,2}$/;
/** PostgREST « function not found » / Postgres « undefined function »: the SQL is not pasted yet. */
const MISSING = new Set(["PGRST202", "42883"]);

/**
 * GET /api/admin/journal/summary — the four tiles of Historique (prototypes/journaux-v3.html).
 *   ?from=<iso period start>  ?market=<uuid>  ?tz=<IANA zone>
 * Returns { families: { team|ext|auto|sec: { events, problems } } | null, routine }.
 * `families` is null until 20261009100000_journal_family_counts.sql is applied.
 */
async function handleGET(req: NextRequest) {
  const s = await journalSession(req);
  if ("response" in s) return s.response;

  const q = req.nextUrl.searchParams;
  const from = q.get("from");
  const market = q.get("market") || null;
  const tz = q.get("tz") || "Africa/Tripoli";
  if (!from || Number.isNaN(Date.parse(from))) return bad("from");
  if (market && !UUID.test(market)) return bad("market");
  if (!TZ.test(tz)) return bad("tz");

  const counts = await s.supabase.rpc("journal_family_counts", { p_from: from, p_market: market });
  let families: Record<Family, { events: number; problems: number }> | null = null;
  if (counts.error) {
    const code = (counts.error as { code?: string }).code ?? "";
    if (!MISSING.has(code)) return rpcFailure(counts.error);
  } else {
    families = Object.fromEntries(FAMILIES.map((f) => [f, { events: 0, problems: 0 }])) as Record<Family, { events: number; problems: number }>;
    for (const r of (counts.data ?? []) as { family: Family; events: number; problems: number }[]) {
      if (families[r.family]) families[r.family] = { events: Number(r.events), problems: Number(r.problems) };
    }
  }

  const { data: routineRows } = await s.supabase.rpc("journal_routine", { p_from: from, p_to: new Date().toISOString(), p_tz: tz });
  const routine = ((routineRows ?? []) as { passes: number }[]).reduce((n, r) => n + Number(r.passes), 0);

  return NextResponse.json({ families, routine });
}

function bad(field: string) {
  return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
}

export const GET = withRouteErrors("/api/admin/journal/summary", "GET", handleGET);

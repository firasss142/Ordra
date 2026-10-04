// GET /api/performance/orders/drill?…same state…&drill=fam:autre&dsel=a:<id>&limit=40
//
// The drawer: the orders behind one number of the page, their breakdowns
// (motif, produit, agent, ville), newest first, 40 at a time.

import { NextRequest, NextResponse } from "next/server";
import { buildDrill, type DrillSel } from "@/lib/performance/orders/build";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { PRIVATE_CACHE, readRequest } from "../shared";

export const dynamic = "force-dynamic";

function parseDsel(raw: string | null): DrillSel | null {
  if (!raw) return null;
  const i = raw.indexOf(":");
  const t = raw.slice(0, i);
  const v = raw.slice(i + 1);
  return ["r", "p", "a", "c"].includes(t) && v ? { t: t as DrillSel["t"], v } : null;
}

async function handleGET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const key = q.get("drill") ?? "";
  const r = await readRequest(req);
  if ("response" in r) return r.response;
  const limit = Math.min(400, Math.max(1, Number(q.get("limit")) || 40));
  const view = buildDrill(r.input, key, parseDsel(q.get("dsel")), limit);
  if (!view) return NextResponse.json({ error: "Unknown drill" }, { status: 400 });
  return NextResponse.json(view, { headers: PRIVATE_CACHE });
}

export const GET = withRouteErrors("/api/performance/orders/drill", "GET", handleGET);

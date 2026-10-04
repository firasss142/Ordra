// GET /api/performance/orders?market_id=…&period=…&p=…&ag=…&cmp=…
//
// Performance › Commandes (prototypes/performance-commandes-v4.html): the
// orders RECEIVED in the period, followed to today, for the chosen products
// and agents — every block of the page, computed here, server-side, by
// lib/performance/orders/build.ts. See plans/performance-commandes.md.

import { NextRequest, NextResponse } from "next/server";
import { buildView } from "@/lib/performance/orders/build";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { PRIVATE_CACHE, readRequest } from "./shared";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const r = await readRequest(req);
  if ("response" in r) return r.response;
  return NextResponse.json(buildView(r.input), { headers: PRIVATE_CACHE });
}

export const GET = withRouteErrors("/api/performance/orders", "GET", handleGET);

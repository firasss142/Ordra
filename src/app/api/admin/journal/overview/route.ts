import { NextRequest, NextResponse } from "next/server";
import { journalSession, rpcFailure } from "@/lib/journal/guard";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/** GET /api/admin/journal/overview — Aperçu: problems, tiles, jobs, security. super_admin. */
async function handleGET(req: NextRequest) {
  const s = await journalSession(req);
  if ("response" in s) return s.response;
  const { data, error } = await s.supabase.rpc("journal_overview");
  if (error) return rpcFailure(error);
  return NextResponse.json(data);
}

export const GET = withRouteErrors("/api/admin/journal/overview", "GET", handleGET);

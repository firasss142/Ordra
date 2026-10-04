import { NextRequest, NextResponse } from "next/server";
import { journalSession } from "@/lib/journal/guard";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SIMPLE = new RegExp(`^(audit|error|call|webhook):(${UUID})$`, "i");
const SETTINGS = new RegExp(`^settings:(${UUID}|-|[\\w-]+):(${UUID}|-|[\\w-]+):(\\d{12})$`, "i");

const TABLE = { audit: "audit_events", error: "app_errors", call: "integration_calls", webhook: "webhook_delivery_log" } as const;
const COLUMNS = {
  audit: "*",
  error: "*",
  call: "id, occurred_at, system, operation, status, http_status, error_code, message, duration_ms, attempt, order_id",
  // the payload stays out: customer phones and addresses
  webhook: "id, source, event, status, error_message, created_at, storefront_id, order_id, external_id",
} as const;

/**
 * GET /api/admin/journal/detail?ref=… — what a feed row's panel shows.
 *   audit:<id>                        the event with its before → after
 *   settings:<by>:<market>:<minute>   every setting that person saved that minute
 *   error:<id> · call:<id> · webhook:<id>
 * Read with the session: RLS lets the super_admin read each of these tables.
 */
async function handleGET(req: NextRequest) {
  const s = await journalSession(req);
  if ("response" in s) return s.response;
  const ref = req.nextUrl.searchParams.get("ref") ?? "";

  const simple = ref.match(SIMPLE);
  if (simple) {
    const type = simple[1].toLowerCase() as keyof typeof TABLE;
    const { data, error } = await s.supabase.from(TABLE[type]).select(COLUMNS[type]).eq("id", simple[2]).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ type, row: data });
  }

  const settings = ref.match(SETTINGS);
  if (settings) {
    const [, by, market, minute] = settings;
    const start = new Date(
      Date.UTC(+minute.slice(0, 4), +minute.slice(4, 6) - 1, +minute.slice(6, 8), +minute.slice(8, 10), +minute.slice(10, 12)),
    );
    let q = s.supabase
      .from("settings_history")
      .select("id, market_id, key, old_value, new_value, changed_by, changed_at")
      .gte("changed_at", start.toISOString())
      .lt("changed_at", new Date(start.getTime() + 60_000).toISOString());
    q = by === "-" ? q.is("changed_by", null) : q.eq("changed_by", by);
    q = market === "-" ? q.is("market_id", null) : q.eq("market_id", market);
    const { data, error } = await q.order("key", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ type: "settings", rows: data ?? [] });
  }

  return NextResponse.json({ error: "Invalid ref" }, { status: 400 });
}

export const GET = withRouteErrors("/api/admin/journal/detail", "GET", handleGET);

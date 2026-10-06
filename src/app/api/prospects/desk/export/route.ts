import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { deskMarket } from "@/lib/prospects/desk/route-market";
import { parseListQuery, toCsv, toDeskRow, DESK_ROW_SELECT, type DeskRow } from "@/lib/prospects/desk/list";
import { deskListQuery } from "@/lib/prospects/desk/query";
import { recordJournalEvent } from "@/lib/journal/record-event";
import { withRouteErrors } from "@/lib/journal/route-errors";
import fr from "@/messages/fr.json";
import ar from "@/messages/ar.json";

export const dynamic = "force-dynamic";

/** A file a spreadsheet opens in one go. Above this, ask for a narrower filter. */
const MAX_ROWS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EXPORT_COLUMNS = ["name", "phone", "city", "source", "why", "product", "value", "agent", "state", "age", "order", "created"] as const;
type Col = (typeof EXPORT_COLUMNS)[number];
const DEFAULT_COLUMNS: Col[] = ["name", "phone", "city", "source", "why", "product", "value", "agent", "state", "age"];

type Words = typeof fr.prospects.desk;
function cellsOf(r: DeskRow, w: Words): Record<Col, unknown> {
  return {
    name: r.name, phone: r.phone, city: r.city, source: w.sources.names[r.source], why: r.reason ?? r.campaignName ?? "",
    product: r.productName, value: r.value, agent: r.agentName ?? w.list.noAgent, state: w.export.states[r.state],
    age: r.ageDays, order: r.sourceOrderRef, created: r.createdAt.slice(0, 10),
  };
}

/**
 * GET /api/prospects/desk/export — the list as a file.
 *   format = excel (semicolons + BOM: Excel opens Arabic correctly) | csv
 *   scope  = filtered (the list's filters) | ids (a selection) | month (every prospect created that month)
 * The export is recorded in Journaux (`export.prospects`).
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const p = req.nextUrl.searchParams;
  const m = deskMarket(actorResult.actor, p.get("market_id"));
  if ("response" in m) return m.response;

  const excel = p.get("format") !== "csv";
  const words: Words = (p.get("lang") === "ar" ? ar : fr).prospects.desk as Words;
  const asked = (p.get("cols") ?? "").split(",").filter((c): c is Col => (EXPORT_COLUMNS as readonly string[]).includes(c));
  const cols = asked.length ? asked : DEFAULT_COLUMNS;
  const scope = p.get("scope") === "ids" ? "ids" : p.get("scope") === "month" ? "month" : "filtered";

  const supabase = await createClient();
  let query;
  if (scope === "filtered") {
    query = deskListQuery(supabase as never, m.marketId, parseListQuery(p));
  } else {
    query = supabase.from("leads").select(DESK_ROW_SELECT).eq("market_id", m.marketId);
    if (scope === "ids") {
      const ids = (p.get("ids") ?? "").split(",").filter((x) => UUID.test(x)).slice(0, MAX_ROWS);
      query = query.in("id", ids);
    } else {
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(p.get("month") ?? "") ? p.get("month")! : new Date().toISOString().slice(0, 7);
      const [y, mo] = month.split("-").map(Number);
      query = query.gte("created_at", `${month}-01`).lt("created_at", new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 10));
    }
    query = query.order("created_at", { ascending: true });
  }
  const { data, error } = await query.limit(MAX_ROWS);
  if (error) {
    console.error("[api/prospects/desk/export] query failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const now = new Date();
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => cellsOf(toDeskRow(r, now), words));
  const body = toCsv(rows, cols.map((c) => ({ key: c, label: words.export.cols[c] })), { sep: excel ? ";" : ",", bom: excel });
  const file = `prospects-${now.toISOString().slice(0, 10)}.csv`;

  await recordJournalEvent(supabase, {
    action: "export.prospects", entityType: "leads", marketId: m.marketId,
    context: { rows: rows.length, format: excel ? "excel" : "csv", scope },
  });

  return new NextResponse(body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"` },
  });
}

export const GET = withRouteErrors("/api/prospects/desk/export", "GET", handleGET);

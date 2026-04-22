import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canCreateLead } from "@/lib/lead-permissions";
import { parseLeadCsv, type ParsedCsvRow } from "@/lib/leads/csv";
import { getActor } from "@/lib/auth/actor";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  // Agents cannot bulk-import (manager/SA workflow).
  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { csv?: string; market_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.csv !== "string" || body.csv.trim().length === 0) {
    return NextResponse.json(
      { error: "csv body field is required" },
      { status: 400 }
    );
  }

  const marketId =
    role === "super_admin" ? (body.market_id ?? actorMarketId) : actorMarketId;

  if (!canCreateLead(role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = parseLeadCsv(body.csv);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error ?? "invalid" }, { status: 400 });
  }

  const validRows: ParsedCsvRow[] = parsed.rows.filter((r) => r.error === null);
  const invalidRows = parsed.rows.filter((r) => r.error !== null);

  if (validRows.length === 0) {
    return NextResponse.json(
      {
        data: {
          imported: 0,
          skipped: parsed.rows.length,
          errors: invalidRows.map((r) => ({
            line: r.lineNumber,
            error: r.error,
          })),
        },
      },
      { status: 200 }
    );
  }

  // Dedup by phone within market (skip phones that already exist).
  const phones = Array.from(new Set(validRows.map((r) => r.customer_phone)));
  const { data: existing } = await supabase
    .from("leads")
    .select("customer_phone")
    .eq("market_id", marketId)
    .in("customer_phone", phones);

  const existingSet = new Set(
    (existing ?? []).map((r) => (r.customer_phone as string) ?? "")
  );

  const toInsert = validRows.filter(
    (r) => !existingSet.has(r.customer_phone)
  );
  const dedupSkipped = validRows.length - toInsert.length;

  const rowsForDb = toInsert.map((r) => ({
    market_id: marketId,
    source: r.source,
    source_platform: "manual",
    status: "new",
    customer_name: r.customer_name,
    customer_phone: r.customer_phone,
    customer_city: r.customer_city,
    customer_address: r.customer_address,
    product_interest_note: r.product_interest_note,
    notes: r.notes,
    assigned_to: null,
  }));

  let imported = 0;
  if (rowsForDb.length > 0) {
    const { data: inserted, error: insertError } = await supabase
      .from("leads")
      .insert(rowsForDb)
      .select("id");
    if (insertError) {
      return NextResponse.json(
        { error: insertError.message },
        { status: 500 }
      );
    }
    imported = inserted?.length ?? rowsForDb.length;

    // Best-effort history inserts (do not block on errors; append-only RLS enforces visibility)
    if (inserted && inserted.length > 0) {
      await supabase.from("lead_history").insert(
        inserted.map((row) => ({
          lead_id: row.id as string,
          status_from: null,
          status_to: "new",
          actor_id: actor.id,
          actor_type: "manager",
          note: "Created via CSV import",
        }))
      );
    }
  }

  return NextResponse.json({
    data: {
      imported,
      skipped: invalidRows.length + dedupSkipped,
      errors: invalidRows.map((r) => ({ line: r.lineNumber, error: r.error })),
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(sp.get("limit") ?? "50", 10)));
  const carrier = sp.get("carrier_code");
  const outcomeFilter = sp.get("outcome"); // processed | ignored | error
  const failuresOnly = sp.get("failures_only") === "true";
  const search = (sp.get("q") ?? "").trim();
  const includePayload = sp.get("include_payload") === "true";

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const selectCols = includePayload
    ? "id, carrier_code, source, tracking_number, carrier_status_raw, order_id, outcome, outcome_reason, raw_body, created_at"
    : "id, carrier_code, source, tracking_number, carrier_status_raw, order_id, outcome, outcome_reason, created_at";

  let query = supabase
    .from("carrier_event_log")
    .select(selectCols, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (carrier) query = query.eq("carrier_code", carrier);

  if (failuresOnly) {
    query = query.in("outcome", ["error", "ignored"]);
  } else if (outcomeFilter && ["processed", "ignored", "error"].includes(outcomeFilter)) {
    query = query.eq("outcome", outcomeFilter);
  }

  if (search) {
    const esc = search.replace(/[%_\\]/g, (m) => `\\${m}`);
    query = query.or(
      `tracking_number.ilike.%${esc}%,outcome_reason.ilike.%${esc}%,carrier_status_raw.ilike.%${esc}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    pagination: { page, limit, total: count ?? 0 },
  });
}

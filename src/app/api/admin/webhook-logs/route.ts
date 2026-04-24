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
  const storefrontId = sp.get("storefront_id");
  const statusFilter = sp.get("status"); // "processed" | "ignored" | "error" | null
  const failuresOnly = sp.get("failures_only") === "true";
  const search = (sp.get("q") ?? "").trim();
  const includePayload = sp.get("include_payload") === "true";

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const selectCols = includePayload
    ? "id, source, event, storefront_id, external_id, order_id, status, error_message, created_at, payload"
    : "id, source, event, storefront_id, external_id, order_id, status, error_message, created_at";

  let query = supabase
    .from("webhook_delivery_log")
    .select(selectCols, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (storefrontId) query = query.eq("storefront_id", storefrontId);

  if (failuresOnly) {
    query = query.eq("status", "error");
  } else if (statusFilter && ["processed", "ignored", "error"].includes(statusFilter)) {
    query = query.eq("status", statusFilter);
  }

  if (search) {
    const esc = search.replace(/[%_\\]/g, (m) => `\\${m}`);
    query = query.or(
      `external_id.ilike.%${esc}%,error_message.ilike.%${esc}%,source.ilike.%${esc}%`,
    );
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    pagination: { page, limit, total: count ?? 0 },
  });
}

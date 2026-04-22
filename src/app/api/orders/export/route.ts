import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";

const STATUS_LABELS: Record<string, string> = {
  new: "Nouveau",
  assigned: "Assigné",
  attempt_1: "Tentative 1",
  attempt_2: "Tentative 2",
  attempt_3: "Tentative 3",
  callback_scheduled: "Rappel planifié",
  confirmed: "Confirmé",
  dispatched: "Expédié",
  deposit: "Déposé",
  in_transit: "En transit",
  delivered: "Livré",
  returned: "Retourné",
  rejected: "Rejeté",
  cancelled: "Annulé",
};

const MAX_EXPORT_ROWS = 10_000;

function escapeCsv(value: string | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const actorMarketId = actor.market_id ?? "";

  // Agents cannot export
  if (role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actorMarketId;

  if (marketId && !canViewOrders(role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = supabase
    .from("orders")
    .select("id, created_at, customer_name, customer_phone, customer_city, product_name, variant_label, total_price, status, assigned_to");

  if (marketId) {
    query = query.eq("market_id", marketId);
  }

  // Filters (same as list route)
  const status = req.nextUrl.searchParams.get("status");
  if (status) query = query.eq("status", status);

  const agentId = req.nextUrl.searchParams.get("agent_id");
  if (agentId) query = query.eq("assigned_to", agentId);

  const productId = req.nextUrl.searchParams.get("product_id");
  if (productId) query = query.eq("product_id", productId);

  const city = req.nextUrl.searchParams.get("city");
  if (city) query = query.eq("customer_city", city);

  const dateFrom = req.nextUrl.searchParams.get("date_from");
  if (dateFrom) query = query.gte("created_at", dateFrom);

  const dateTo = req.nextUrl.searchParams.get("date_to");
  if (dateTo) query = query.lte("created_at", dateTo);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(MAX_EXPORT_ROWS);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const rows = data ?? [];

  // Build CSV
  const headers = ["ID", "Date", "Client", "Téléphone", "Ville", "Produit", "Variante", "Prix total", "Statut", "Agent", "Créé le"];
  const csvLines = [headers.join(",")];

  for (const row of rows) {
    csvLines.push(
      [
        escapeCsv(row.id),
        escapeCsv(row.created_at ? new Date(row.created_at).toLocaleDateString("fr-FR") : ""),
        escapeCsv(row.customer_name),
        escapeCsv(row.customer_phone),
        escapeCsv(row.customer_city),
        escapeCsv(row.product_name),
        escapeCsv(row.variant_label),
        escapeCsv(String(row.total_price ?? "")),
        escapeCsv(STATUS_LABELS[row.status] ?? row.status),
        escapeCsv(row.assigned_to ?? ""),
        escapeCsv(row.created_at),
      ].join(",")
    );
  }

  const csv = csvLines.join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="orders-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

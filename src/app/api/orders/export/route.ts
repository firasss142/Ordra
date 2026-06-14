import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  new: "Nouveau",
  assigned: "Assigné",
  pending: "En attente",
  attempt_1: "Tentative 1",
  attempt_2: "Tentative 2",
  attempt_3: "Tentative 3",
  callback_scheduled: "Rappel planifié",
  confirmed: "Confirmé",
  dispatch_scheduled: "Planifiée",
  uploaded: "Téléchargé",
  scanned: "Scanné",
  dispatched: "Expédié",
  deposit: "Déposé",
  in_transit: "En transit",
  unverified: "À vérifier",
  to_be_returned: "À retourner",
  received: "Reçu en retour",
  delivered: "Livré",
  returned: "Retourné",
  rejected: "Rejeté",
  cancelled: "Annulé",
  deleted: "Supprimé",
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

  const includeDeleted =
    req.nextUrl.searchParams.get("include_deleted") === "1" ||
    req.nextUrl.searchParams.get("include_deleted") === "true";
  // "Afficher supprimées": when on, export ONLY deleted orders; otherwise hide them.
  if (includeDeleted) {
    query = query.eq("status", "deleted");
  } else {
    query = query.neq("status", "deleted");
  }

  const status = req.nextUrl.searchParams.get("status");
  if (status) {
    const list = status.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length === 1) query = query.eq("status", list[0]);
    else if (list.length > 1) query = query.in("status", list);
  }

  const q = req.nextUrl.searchParams.get("q");
  if (q && q.trim().length > 0) {
    const needle = q.trim().replace(/[%,]/g, "");
    if (needle) {
      query = query.or(
        `customer_name.ilike.%${needle}%,customer_phone.ilike.%${needle}%,external_id.ilike.%${needle}%,product_name.ilike.%${needle}%`,
      );
    }
  }

  const rejectionReason = req.nextUrl.searchParams.get("rejection_reason");
  if (rejectionReason) query = query.eq("rejection_reason", rejectionReason);

  const carrierId = req.nextUrl.searchParams.get("carrier_id");
  if (carrierId) query = query.eq("carrier_id", carrierId);

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

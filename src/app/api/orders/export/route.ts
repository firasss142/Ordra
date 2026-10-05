import { NextRequest, NextResponse } from "next/server";
import { listQuerySchema } from "@/lib/orders/list-filters";
import { applyOrderListFilters } from "@/lib/orders/list-query";
import { loadListContext } from "@/lib/orders/list-context";
import { createClient } from "@/lib/supabase/server";
import { canViewOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";
import { resolveProductDisplayName } from "@/lib/orders/display-name";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { recordJournalEvent } from "@/lib/journal/record-event";

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

async function handleGET(req: NextRequest) {
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
    .select("id, created_at, customer_name, customer_phone, customer_city, product_name, variant_label, total_price, status, assigned_to, product:products!orders_product_id_fkey(name)");

  // The list's own filters (lib/orders/list-query), so the CSV is exactly the
  // rows the operator was looking at when they pressed Exporter.
  // market_id is resolved above (and checked); the schema reads the filters.
  const { market_id: _market, ...filterParams } = Object.fromEntries(req.nextUrl.searchParams.entries());
  void _market;
  const parsed = listQuerySchema.safeParse(filterParams);
  if (!parsed.success) return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  const ctx = await loadListContext(supabase, parsed.data, marketId || null);
  query = applyOrderListFilters(query, parsed.data, ctx);

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
        escapeCsv(resolveProductDisplayName(row)),
        escapeCsv(row.variant_label),
        escapeCsv(String(row.total_price ?? "")),
        escapeCsv(STATUS_LABELS[row.status] ?? row.status),
        escapeCsv(row.assigned_to ?? ""),
        escapeCsv(row.created_at),
      ].join(",")
    );
  }

  const csv = csvLines.join("\n");

  // Journaux: who exported how many rows. Through the session (allowed for
  // export.*), so the journal names the signed-in user. Never fails or holds
  // the download (recordJournalEvent swallows and times out).
  await recordJournalEvent(supabase, {
    action: "export.orders",
    entityType: "orders",
    marketId: marketId || null,
    context: { rows: rows.length, format: "csv" },
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="orders-export-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

export const GET = withRouteErrors("/api/orders/export", "GET", handleGET);

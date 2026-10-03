import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { reasonsForKind, type HistoryKind } from "@/lib/warehouse/history-reasons";

export const dynamic = "force-dynamic";

/**
 * How many events each Mouvements chip holds — « Tout 225 · Sorties 225 ».
 *
 * Head counts only, one per family, all in parallel: a fixed number of queries
 * whatever the size of the ledger. Each ledger family is counted with
 * `reasonsForKind`, the list the ledger query itself uses, so a chip's number
 * and the rows it then shows cannot disagree.
 */

export type HistoryCounts = Record<
  "all" | "scan" | "return" | "reception" | "count" | "adjust" | "handover" | "print",
  number
>;

const LEDGER_FAMILIES = ["scan", "return", "reception", "count", "adjust"] as const;

const querySchema = z.object({ product_id: z.string().uuid().optional() });

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }
  const productId = parsed.data.product_id ?? null;

  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);

  const ledger = async (kind: HistoryKind): Promise<number> => {
    let qb = supabase
      .from("inventory_log")
      .select("id, products!inner(market_id)", { count: "exact", head: true })
      .in("reason", reasonsForKind(kind));
    if (marketId) qb = qb.eq("products.market_id", marketId);
    if (productId) qb = qb.eq("product_id", productId);
    const { count, error } = await qb;
    if (error) throw new Error(`inventory_log: ${error.message}`);
    return count ?? 0;
  };

  // A print or a handover has no product: filtered on one, they are zero by
  // definition and are not asked for.
  const prints = async (): Promise<number> => {
    if (productId) return 0;
    let qb = supabase.from("label_prints").select("id", { count: "exact", head: true });
    if (marketId) qb = qb.eq("market_id", marketId);
    const { count, error } = await qb;
    if (error) throw new Error(`label_prints: ${error.message}`);
    return count ?? 0;
  };
  const handovers = async (): Promise<number> => {
    if (productId) return 0;
    let qb = supabase
      .from("order_history")
      .select("id", { count: "exact", head: true })
      .eq("status_to", "dispatched");
    if (marketId) qb = qb.eq("market_id", marketId);
    const { count, error } = await qb;
    if (error) throw new Error(`order_history: ${error.message}`);
    return count ?? 0;
  };

  try {
    const [whole, print, handover, ...families] = await Promise.all([
      ledger("all"),
      prints(),
      handovers(),
      ...LEDGER_FAMILIES.map((k) => ledger(k)),
    ]);
    const body: HistoryCounts = {
      all: whole + print + handover,
      scan: families[0],
      return: families[1],
      reception: families[2],
      count: families[3],
      adjust: families[4],
      handover,
      print,
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=30" },
    });
  } catch {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { warehouseHistoryQuerySchema } from "@/lib/warehouse/list-filters";
import { getWarehouseHistoryPage } from "@/lib/warehouse/history-fetch";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";

export const dynamic = "force-dynamic";

export type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parseResult = warehouseHistoryQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid query parameters" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  // Same rule as the rest of the console: a super-admin viewing Libye must not
  // be handed a Tunisian ledger. This route used to pass null for them.
  const { marketId: scopeMarket } = resolveWarehouseScope(req, actor);
  const page = await getWarehouseHistoryPage(supabase, parseResult.data, scopeMarket);

  return NextResponse.json(page, {
    headers: {
      "Cache-Control": "private, max-age=2, stale-while-revalidate=30",
    },
  });
}

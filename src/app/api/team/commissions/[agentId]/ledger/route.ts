import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageCommissions } from "@/lib/role-permissions";
import { ISO_DAY } from "@/lib/commissions/api";
import type { CommissionLedgerEntry } from "@/lib/commissions/types";

export const dynamic = "force-dynamic";

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * GET /api/team/commissions/[agentId]/ledger?from_date&to_date&format=csv
 * One agent's statement. The RPC returns [] for anyone who is not a manager
 * of the agent's market (or super_admin) — no data leaks through the shape.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ agentId: string }> }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (!canManageCommissions(actorResult.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { agentId } = await params;
  const from = req.nextUrl.searchParams.get("from_date");
  const to = req.nextUrl.searchParams.get("to_date");
  if ((from && !ISO_DAY.test(from)) || (to && !ISO_DAY.test(to))) {
    return NextResponse.json({ error: "from_date/to_date must be YYYY-MM-DD" }, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_agent_commission_ledger", {
    p_agent_id: agentId,
    p_from: from ?? null,
    p_to: to ?? null,
    p_limit: 2000,
  });
  if (error) {
    console.error("[api/team/commissions/ledger] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const rows = (data ?? []) as CommissionLedgerEntry[];

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const head = ["date", "type", "amount", "rate", "order", "product", "method", "reference", "note", "by"];
    const lines = rows.map((r) =>
      [r.effective_at, r.entry_type, r.amount, r.rate_amount, r.external_id, r.product_name, r.method, r.reference, r.note, r.created_by_name]
        .map(csvCell)
        .join(","),
    );
    return new NextResponse([head.join(","), ...lines].join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="commissions-${agentId}.csv"`,
      },
    });
  }
  return NextResponse.json({ data: rows });
}

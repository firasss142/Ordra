import { NextRequest, NextResponse } from "next/server";
import { getActor, type Actor } from "@/lib/auth/actor";
import { canManageInvestments, canViewInvestorAdmin } from "@/lib/investor-permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { marketTimezone } from "@/lib/markets";
import { localDateISO } from "./facts/order-facts";

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Ctx = { actor: Actor; admin: ReturnType<typeof createAdminClient> };

/** Read access: super_admin + market_manager (own market). */
export async function adminReader(req: NextRequest): Promise<Ctx | { response: NextResponse }> {
  const r = await getActor(req);
  if ("response" in r) return r;
  if (!canViewInvestorAdmin(r.actor.role)) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { actor: r.actor, admin: createAdminClient() };
}

/** Write access: super_admin only (money movement). */
export async function adminWriter(req: NextRequest): Promise<Ctx | { response: NextResponse }> {
  const r = await getActor(req);
  if ("response" in r) return r;
  if (!canManageInvestments(r.actor.role)) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { actor: r.actor, admin: createAdminClient() };
}

export function todayFor(marketId: string | null): string {
  return localDateISO(new Date().toISOString(), marketTimezone(marketId));
}

/** Map a Postgres RPC error to an HTTP response with a stable code. */
export function rpcError(error: { message: string; details?: string | null; code?: string }, fallbackLog: string): NextResponse {
  const m = error.message ?? "";
  const known: [string, number][] = [
    ["TERMS_BEFORE_SETTLED", 409], ["TERMS_BEFORE_START", 422], ["MATURITY_BEFORE_START", 422], ["DEAL_CLOSED", 409],
    ["PERIOD_NOT_CONTIGUOUS", 409], ["INSUFFICIENT_AVAILABLE", 422], ["ILLEGAL_TRANSITION", 409], ["EXIT_BEFORE_SETTLED", 409],
  ];
  for (const [code, status] of known) if (m.includes(code)) return NextResponse.json({ error: code, code, detail: error.details ?? null }, { status });
  if (m.includes("not found")) return NextResponse.json({ error: m, code: "NOT_FOUND" }, { status: 404 });
  if (error.code === "23514" || m.includes("must be")) return NextResponse.json({ error: m, code: "VALIDATION" }, { status: 422 });
  console.error(fallbackLog, error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

import { NextResponse } from "next/server";

/**
 * Map a Postgres error raised by a commission RPC to an HTTP status the UI
 * can act on. The RPCs raise with SQLSTATEs on purpose:
 *   42501 insufficient_privilege → 403
 *   P0002 no_data_found          → 404
 *   23514 check_violation        → 400, or 409 when it is the NEGATIVE_BALANCE
 *                                  refusal (the client re-sends with
 *                                  allow_negative once the manager confirms)
 */
export function rpcErrorResponse(scope: string, error: { message?: string; code?: string } | null): NextResponse {
  const msg = error?.message ?? "";
  if (error?.code === "42501") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (error?.code === "P0002") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (msg.startsWith("NEGATIVE_BALANCE")) {
    return NextResponse.json({ error: msg, code: "NEGATIVE_BALANCE" }, { status: 409 });
  }
  if (error?.code === "23514") return NextResponse.json({ error: msg || "Invalid request" }, { status: 400 });
  console.error(`[${scope}] rpc failed`, error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

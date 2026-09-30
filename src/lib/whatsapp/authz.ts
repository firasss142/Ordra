/**
 * Who may touch a market's WhatsApp setup, from a route's actor.
 *
 * Three answers, never inferred from the request body's market alone:
 * super_admin — any market (must name one); market_manager — their own,
 * whatever the body says; agent — read-only on their own market (the
 * composer needs the approved template list); everyone else — nothing.
 */
import type { Actor } from "@/lib/auth/actor";

export type MarketAccess = { ok: true; marketId: string } | { ok: false; status: 400 | 403; error: string };

export function resolveMarketForRead(actor: Actor, requested: string | null | undefined): MarketAccess {
  if (actor.role === "super_admin") {
    return requested ? { ok: true, marketId: requested } : { ok: false, status: 400, error: "market_id is required" };
  }
  if (actor.role === "market_manager" || actor.role === "agent") {
    return actor.market_id ? { ok: true, marketId: actor.market_id } : { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: false, status: 403, error: "Forbidden" };
}

export function resolveMarketForManage(actor: Actor, requested: string | null | undefined): MarketAccess {
  if (actor.role === "super_admin") {
    return requested ? { ok: true, marketId: requested } : { ok: false, status: 400, error: "market_id is required" };
  }
  if (actor.role === "market_manager") {
    if (!actor.market_id) return { ok: false, status: 403, error: "Forbidden" };
    if (requested && requested !== actor.market_id) return { ok: false, status: 403, error: "Forbidden" };
    return { ok: true, marketId: actor.market_id };
  }
  return { ok: false, status: 403, error: "Forbidden" };
}

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveMarketForManage } from "@/lib/whatsapp/authz";
import { normalizePhone } from "@/lib/leads/phone";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * GET /api/whatsapp/claim-search?market_id=&q= — the « Rattacher à » search:
 * live orders and open prospects of the market, by name, phone or reference.
 * Small on purpose (5 + 5 rows): a manager is matching one conversation, not
 * browsing.
 *
 * With nothing typed (q shorter than 2) it answers with the market's most
 * recent live orders and open prospects — the prototype shows results before
 * the search, and a fresh conversation usually belongs to a fresh order. A
 * prospect carries its campaign's name (`campaign_name`), which is how a
 * manager recognises a reply to a campaign.
 */

export const dynamic = "force-dynamic";

const TERMINAL = ["delivered", "returned", "rejected", "cancelled", "deleted"];
const CLOSED_LEADS = ["won", "lost", "archived"];
const LIMIT = 5;

function escapeLike(s: string): string {
  return s.replace(/[%_,.()]/g, " ").trim();
}

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const url = new URL(req.url);
  const access = resolveMarketForManage(actorResult.actor, url.searchParams.get("market_id"));
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const q = escapeLike(url.searchParams.get("q") ?? "");
  const searching = q.length >= 2;

  const admin = createAdminClient();
  let orders = admin
    .from("orders")
    .select("id, external_id, customer_name, customer_phone, customer_city, status, created_at")
    .eq("market_id", access.marketId)
    .not("status", "in", `(${TERMINAL.join(",")})`);
  let leads = admin
    .from("leads")
    .select("id, customer_name, customer_phone, customer_city, status, campaign_id, created_at")
    .eq("market_id", access.marketId)
    .not("status", "in", `(${CLOSED_LEADS.join(",")})`);

  if (searching) {
    const digits = normalizePhone(q);
    const phone = digits.length >= 3 ? [`customer_phone.ilike.%${digits}%`] : [];
    orders = orders.or([`customer_name.ilike.%${q}%`, `external_id.ilike.%${q}%`, ...phone].join(","));
    leads = leads.or([`customer_name.ilike.%${q}%`, ...phone].join(","));
  }

  const [ordersRes, leadsRes] = await Promise.all([
    orders.order("created_at", { ascending: false }).limit(LIMIT),
    leads.order("created_at", { ascending: false }).limit(LIMIT),
  ]);

  const leadRows = (leadsRes.data ?? []) as { campaign_id: string | null }[];
  const campaignIds = Array.from(new Set(leadRows.map((l) => l.campaign_id).filter((id): id is string => Boolean(id))));
  const names = new Map<string, string>();
  if (campaignIds.length > 0) {
    const { data: camps } = await admin.from("prospect_campaigns").select("id, name").eq("market_id", access.marketId).in("id", campaignIds);
    for (const c of (camps ?? []) as { id: string; name: string }[]) names.set(c.id, c.name);
  }

  return NextResponse.json({
    data: {
      orders: ordersRes.data ?? [],
      leads: leadRows.map((l) => ({ ...l, campaign_name: l.campaign_id ? (names.get(l.campaign_id) ?? null) : null })),
      recent: !searching,
    },
  });
}

export const GET = withRouteErrors("/api/whatsapp/claim-search", "GET", handleGET);

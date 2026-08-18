import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/orders/[id]/darb-shipment
 *
 * Everything Darb Assabil knows about one order, read from the LOCAL MIRROR:
 * the courier holding it and their phone, the branch office, the courier's own
 * notes, the carrier comment thread, the real billed cost, the cancellation
 * reason, and the full event history with who performed each step.
 *
 * WHY the mirror and not the carrier: the old panel called Darb on every open
 * (~600ms, and dead when the vendor is down) and displayed only a list of
 * Arabic event labels — it threw away the courier, the phone, the notes and the
 * cost on every render. The scheduled sweep now keeps the mirror current, so
 * this route is a local read that returns strictly more information.
 *
 * Auth via the RLS-scoped client → market isolation enforced at the data layer.
 * An order the caller cannot see returns 404, same as the rest of the panel.
 *
 * 200 → { shipment, timeline, comments } | { shipment: null } when the carrier
 *       has no record for this order (hard-deleted, or never synced yet)
 */

export const dynamic = "force-dynamic";

export interface DarbShipmentDetail {
  darb_id: string;
  reference: string | null;
  original_reference: string | null;
  status_slug: string | null;
  /** Courier currently holding the parcel. */
  handler_name: string | null;
  handler_phone: string | null;
  handler_account_name: string | null;
  handler_account_phone: string | null;
  /** The courier's own note about why it hasn't moved. */
  latest_remark: string | null;
  latest_remark_at: string | null;
  latest_comment: string | null;
  comment_count: number;
  cancellation_cause: string | null;
  delayed_until: string | null;
  cancel_count: number | null;
  resend_count: number | null;
  billed_shipping_amount: number | null;
  billed_currency: string | null;
  shipping_breakdown: Record<string, number> | null;
  cod_outstanding: number | null;
  delivery_withdrawal_at: string | null;
  completed_at: string | null;
  to_city: string | null;
  to_area: string | null;
  to_address: string | null;
  to_branch_group: string | null;
  service_title: string | null;
  priority: number | null;
  notes: string | null;
  attachments: Array<{ url: string; mimeType: string | null; alt: string | null }>;
  last_synced_at: string;
  carrier_updated_at: string | null;
}

export interface DarbTimelineEntry {
  event_id: string;
  type: string;
  description_ar: string | null;
  description_en: string | null;
  remarks: string | null;
  actor_name: string | null;
  actor_phone: string | null;
  occurred_at: string | null;
}

export interface DarbCommentEntry {
  message_id: string;
  message: string;
  author_name: string | null;
  posted_at: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: orderId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS-scoped: an order in another market simply isn't visible.
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .single<{ id: string }>();
  if (orderError || !order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: shipment } = await supabase
    .from("darb_shipments")
    .select(
      `darb_id, reference, original_reference, status_slug,
       handler_name, handler_phone, handler_account_name, handler_account_phone,
       latest_remark, latest_remark_at, latest_comment, comment_count,
       cancellation_cause, delayed_until, cancel_count, resend_count,
       billed_shipping_amount, billed_currency, shipping_breakdown, cod_outstanding,
       delivery_withdrawal_at, completed_at,
       to_city, to_area, to_address, to_branch_group,
       service_title, priority, notes, attachments,
       last_synced_at, carrier_updated_at`,
    )
    .eq("order_id", orderId)
    .maybeSingle();

  // No mirror row is a real, meaningful state — the carrier has no record of
  // this order (hard-deleted there, or dispatched since the last sweep). The
  // panel says so rather than showing an error.
  if (!shipment) {
    return NextResponse.json({ shipment: null, timeline: [], comments: [] });
  }

  const darbId = shipment.darb_id as string;

  const [{ data: timeline }, { data: comments }] = await Promise.all([
    supabase
      .from("darb_timeline_events")
      .select(
        "event_id, type, description_ar, description_en, remarks, actor_name, actor_phone, occurred_at",
      )
      .eq("darb_id", darbId)
      .order("occurred_at", { ascending: false }),
    supabase
      .from("darb_conversation")
      .select("message_id, message, author_name, posted_at")
      .eq("darb_id", darbId)
      .order("posted_at", { ascending: false }),
  ]);

  return NextResponse.json({
    shipment,
    timeline: timeline ?? [],
    comments: comments ?? [],
  });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canCaptureFeedback } from "@/lib/role-permissions";
import { isUuid } from "@/lib/feedback/api";
import { momentOf } from "@/lib/feedback/moment";
import type { FeedbackContext } from "@/types/feedback";

export const dynamic = "force-dynamic";

/** Enough to count a customer's history; a customer with more has not been answered. */
const HISTORY_CAP = 200;

/**
 * GET /api/feedback/context?order_id= — what the capture window shows above the three
 * category cards: the order (reference, customer, product and its photo), the moment its
 * status implies, and what this customer has already told us — « Ce client a déjà 2 retours ·
 * 1 réclamation ouverte » with the words of the open one.
 *
 * Reads under the caller's RLS: an agent sees the order only if it is theirs, and every
 * entry of their market (customer_feedback is readable market-wide by design).
 */
export async function GET(req: NextRequest) {
  const result = await getActor(req);
  if ("response" in result) return result.response;
  if (!canCaptureFeedback(result.actor.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orderId = req.nextUrl.searchParams.get("order_id");
  if (!isUuid(orderId)) return NextResponse.json({ error: "invalid_order_id" }, { status: 400 });

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, external_id, status, tracking_number, customer_id, customer_name, customer_phone, product_id, product_name")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const o = order as {
    id: string; external_id: string | null; status: string; tracking_number: string | null;
    customer_id: string | null; customer_name: string | null; customer_phone: string | null;
    product_id: string | null; product_name: string | null;
  };

  const [productRes, historyRes] = await Promise.all([
    o.product_id
      ? supabase.from("products").select("id, name, image_url").eq("id", o.product_id).maybeSingle()
      : Promise.resolve({ data: null }),
    o.customer_id
      ? supabase
          .from("customer_feedback")
          .select("id, category, status, body, created_at")
          .eq("customer_id", o.customer_id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(HISTORY_CAP)
      : Promise.resolve({ data: [] }),
  ]);

  const product = productRes.data as { id: string; name: string; image_url: string | null } | null;
  const history = (historyRes.data ?? []) as { category: string; status: string | null; body: string }[];
  const open = history.filter((h) => h.category === "reclamation" && (h.status === "open" || h.status === "in_progress"));

  const data: FeedbackContext = {
    order: {
      id: o.id,
      ref: o.external_id ?? o.id.slice(0, 8),
      status: o.status,
      moment: momentOf(o.status, o.tracking_number !== null),
      customer_id: o.customer_id,
      customer_name: o.customer_name ?? "",
      customer_phone: o.customer_phone ?? "",
      product: product
        ? { id: product.id, name: product.name, image_url: product.image_url }
        : o.product_id
          ? { id: o.product_id, name: o.product_name ?? "", image_url: null }
          : null,
    },
    history: {
      count: history.length,
      open: open.length,
      quote: open[0]?.body ?? history[0]?.body ?? null,
    },
  };
  return NextResponse.json({ data });
}

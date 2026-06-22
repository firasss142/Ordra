import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { createAdminClient } from "@/lib/supabase/server";
import { performDispatch } from "@/lib/carriers/perform-dispatch";
import {
  resolveOrderDispatch,
  type PreflightOrder,
  type SkipReason,
} from "@/lib/carriers/bulk-dispatch-preflight";
import { enrichRowsWithDuplicates } from "@/lib/duplicate-orders/detect";

export const dynamic = "force-dynamic";

const MAX_BATCH = 200;

// Order fields the preflight inspects + the ones the duplicate guard needs.
const ORDER_COLS =
  "id, status, market_id, customer_city, customer_address, dexpress_state_id, darb_destination_id, customer_phone, customer_phone_2, product_id, product_name, quantity, created_at";

type OrderRow = PreflightOrder & {
  darb_destination_id: string | number | null;
  customer_phone: string | null;
  customer_phone_2: string | null;
  product_id: string | null;
  product_name: string | null;
  quantity: number | null;
  created_at: string | null;
};

type CarrierRow = {
  id: string;
  code: string;
  market_id: string;
  is_active: boolean;
};

/**
 * Bulk upload selected orders to one carrier/account. Unlike assign-to-agent,
 * upload needs a PER-ORDER destination, so this resolves each order's
 * destination server-side (the same way the cron does) and reports the ones
 * that can't be resolved instead of mis-shipping them.
 *
 * `dry_run: true` returns the eligibility breakdown only (for the UI preview);
 * otherwise it dispatches the eligible orders and returns per-order results.
 * Managers/super_admin only.
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    order_ids?: unknown;
    carrier_id?: unknown;
    dry_run?: unknown;
    confirm_duplicates?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderIds = body.order_ids;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "Missing order_ids" }, { status: 400 });
  }
  if (orderIds.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `Cannot dispatch more than ${MAX_BATCH} orders in one batch` },
      { status: 400 },
    );
  }
  const ids = orderIds.filter((x): x is string => typeof x === "string" && !!x);

  const carrierId = body.carrier_id;
  if (typeof carrierId !== "string" || !carrierId) {
    return NextResponse.json({ error: "Missing carrier_id" }, { status: 400 });
  }
  const dryRun = body.dry_run === true;
  const confirmDuplicates = body.confirm_duplicates === true;

  const admin = createAdminClient();

  // Carrier first — its code decides how destinations resolve.
  const { data: carrier } = await admin
    .from("carriers")
    .select("id, code, market_id, is_active")
    .eq("id", carrierId)
    .maybeSingle<CarrierRow>();

  if (!carrier) {
    return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
  }
  if (!carrier.is_active) {
    return NextResponse.json({ error: "Carrier is not active" }, { status: 400 });
  }

  const { data: orderRows, error: ordersError } = await admin
    .from("orders")
    .select(ORDER_COLS)
    .in("id", ids);

  if (ordersError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const orderById = new Map<string, OrderRow>(
    ((orderRows as OrderRow[] | null) ?? []).map((o) => [o.id, o]),
  );

  // Darb context: the default service id (carrier rows have none) + the
  // persisted (city, area) for any order that already has a destination.
  let defaultDarbServiceId: string | null = null;
  const darbDestById = new Map<string, { city: string; area: string }>();
  if (carrier.code === "darb_assabil") {
    const { data: svc } = await admin
      .from("darb_services")
      .select("service_id")
      .eq("is_default", true)
      .eq("is_active", true)
      .maybeSingle<{ service_id: string }>();
    defaultDarbServiceId = svc?.service_id ?? null;

    const destIds = Array.from(
      new Set(
        ((orderRows as OrderRow[] | null) ?? [])
          .map((o) => o.darb_destination_id)
          .filter((d): d is string | number => d != null)
          .map((d) => String(d)),
      ),
    );
    if (destIds.length > 0) {
      const { data: dests } = await admin
        .from("darb_destinations")
        .select("id, city, area")
        .in("id", destIds);
      for (const d of (dests as Array<{ id: string | number; city: string; area: string }> | null) ?? []) {
        darbDestById.set(String(d.id), { city: d.city, area: d.area });
      }
    }
  }

  // Run the pure preflight per requested id (preserve input order).
  const eligible: Array<{ order_id: string; extra: Record<string, unknown> | undefined; row: OrderRow }> = [];
  const skipped: Array<{ order_id: string; reason: SkipReason }> = [];
  for (const id of ids) {
    const row = orderById.get(id);
    const darbDestination =
      row && row.darb_destination_id != null
        ? darbDestById.get(String(row.darb_destination_id)) ?? null
        : null;
    const res = resolveOrderDispatch(row, carrier, {
      darbDestination,
      defaultDarbServiceId,
    });
    if (res.eligible) {
      eligible.push({ order_id: id, extra: res.extra, row: row! });
    } else {
      skipped.push({ order_id: id, reason: res.reason });
    }
  }

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      eligible: eligible.map((e) => e.order_id),
      skipped,
    });
  }

  // Duplicate-upload guard, batched. An eligible order whose sibling is already
  // shipped goes to needs_confirmation (not dispatched) unless the caller has
  // confirmed the whole batch — mirrors the single-order confirm_duplicate.
  const needsConfirmation: Array<{ order_id: string; duplicate_external_id: string | null }> = [];
  let toDispatch = eligible;
  if (!confirmDuplicates && eligible.length > 0) {
    const enriched = await enrichRowsWithDuplicates(
      admin,
      carrier.market_id,
      eligible.map((e) => e.row),
    );
    const enrichedById = new Map(enriched.map((r) => [r.id, r]));
    toDispatch = [];
    for (const e of eligible) {
      const dup = enrichedById.get(e.order_id);
      if (dup?.has_uploaded_sibling) {
        const shipped = dup.duplicate_siblings.find((s) => s.already_shipped);
        needsConfirmation.push({
          order_id: e.order_id,
          duplicate_external_id: shipped?.external_id ?? null,
        });
      } else {
        toDispatch.push(e);
      }
    }
  }

  const succeeded: Array<{ order_id: string; tracking_number: string | null }> = [];
  const failed: Array<{ order_id: string; error: string; errorCode?: string }> = [];
  for (const e of toDispatch) {
    const result = await performDispatch({
      orderId: e.order_id,
      carrierId,
      actorId: actor.id,
      extra: e.extra,
    });
    if (result.ok) {
      succeeded.push({ order_id: e.order_id, tracking_number: result.trackingNumber });
    } else {
      failed.push({
        order_id: e.order_id,
        error: result.error,
        ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      });
    }
  }

  return NextResponse.json({
    dry_run: false,
    succeeded,
    failed,
    skipped,
    needs_confirmation: needsConfirmation,
  });
}

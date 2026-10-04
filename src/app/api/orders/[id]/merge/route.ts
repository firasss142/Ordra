import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { lockedResponse } from "@/lib/orders/order-lock-response";
import { asOrderLockedError } from "@/lib/orders/order-lock";
import { getMergeWindowHours } from "@/lib/orders/merge-window";
import { resolveMergeAddress, type AddressChoice } from "@/lib/orders/merge";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Merges another order into `[id]`, which survives.
 *
 * The address is the reason this route exists rather than a direct RPC call
 * from the client: of 187 real merge candidates measured in Libya, 96 had a
 * different delivery address and 65 a different city. When the two disagree and
 * the caller has not chosen, this refuses — a default would silently redirect
 * someone's parcel.
 */
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: survivorId } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const absorbedId = typeof body.absorbed_id === "string" ? body.absorbed_id : "";
  if (!absorbedId) {
    return NextResponse.json({ error: "absorbed_id is required" }, { status: 400 });
  }
  if (absorbedId === survivorId) {
    return NextResponse.json(
      { error: "Cannot merge an order into itself" },
      { status: 400 },
    );
  }

  const choice = (body.address_choice ?? null) as AddressChoice;
  const note = typeof body.note === "string" ? body.note.trim() || null : null;

  const supabase = await createClient();

  // Read both orders under RLS — this is also what scopes the request to a
  // market the caller may actually see.
  const { data: rows, error: readError } = await supabase
    .from("orders")
    .select("id, market_id, customer_address, customer_city")
    .in("id", [survivorId, absorbedId]);

  if (readError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const survivor = (rows ?? []).find((r) => r.id === survivorId);
  const absorbed = (rows ?? []).find((r) => r.id === absorbedId);
  if (!survivor || !absorbed) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const windowHours = await getMergeWindowHours(supabase, survivor.market_id);
  if (windowHours <= 0) {
    return NextResponse.json(
      { error: "Merging is disabled for this market", reason: "merge_disabled" },
      { status: 422 },
    );
  }

  // The refusal that protects the customer's address.
  const address = resolveMergeAddress(
    {
      id: survivor.id,
      market_id: survivor.market_id,
      status: "",
      customer_phone: null,
      customer_address: survivor.customer_address,
      customer_city: survivor.customer_city,
      product_id: null,
      created_at: "",
    },
    {
      id: absorbed.id,
      market_id: absorbed.market_id,
      status: "",
      customer_phone: null,
      customer_address: absorbed.customer_address,
      customer_city: absorbed.customer_city,
      product_id: null,
      created_at: "",
    },
    choice,
  );

  if (!address.ok) {
    return NextResponse.json(
      {
        error: "The two orders have different addresses; choose one",
        reason: address.reason,
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("merge_orders", {
    p_survivor_id: survivorId,
    p_absorbed_id: absorbedId,
    p_actor_id: actor.id,
    p_customer_address: address.customer_address,
    p_customer_city: address.customer_city,
    p_window_hours: windowHours,
    p_note: note,
  });

  if (error) {
    // The presence guard is a refusal, not a fault — check it first.
    const locked = asOrderLockedError(error);
    if (locked) {
      const res = lockedResponse(locked);
      if (res) return res;
    }
    switch (error.code) {
      case "42501":
        return NextResponse.json(
          { error: "Forbidden", reason: error.message },
          { status: 403 },
        );
      case "23514":
        return NextResponse.json(
          { error: error.message, reason: error.message },
          { status: 422 },
        );
      case "22023":
        return NextResponse.json({ error: error.message }, { status: 400 });
      case "P0002":
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      default:
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  return NextResponse.json({ data });
}

export const POST = withRouteErrors("/api/orders/[id]/merge", "POST", handlePOST);

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canConvertLead } from "@/lib/lead-permissions";
import { convertLeadToOrder } from "@/lib/leads/conversion";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  const { data: lead } = await supabase
    .from("leads")
    .select("id, status, assigned_to, market_id")
    .eq("id", id)
    .single();

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (role === "agent" && lead.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  if (
    role === "market_manager" &&
    lead.market_id !== (actor.market_id ?? "")
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!canConvertLead(role, actor.id, lead)) {
    return NextResponse.json(
      { error: "Lead cannot be converted (must be qualified and accessible)" },
      { status: 409 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const required = [
    "product_name",
    "quantity",
    "unit_price",
    "total_price",
    "customer_name",
    "customer_phone",
  ];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === "") {
      return NextResponse.json(
        { error: `${k} is required` },
        { status: 400 }
      );
    }
  }

  try {
    const result = await convertLeadToOrder(supabase, {
      leadId: id,
      actorId: actor.id,
      order: {
        product_id: (body.product_id as string | null) ?? null,
        product_name: body.product_name as string,
        variant_label: (body.variant_label as string | null) ?? null,
        quantity: Number(body.quantity),
        unit_price: Number(body.unit_price),
        total_price: Number(body.total_price),
        customer_name: body.customer_name as string,
        customer_phone: body.customer_phone as string,
        customer_address: (body.customer_address as string | null) ?? null,
        customer_city: (body.customer_city as string | null) ?? null,
        customer_note: (body.customer_note as string | null) ?? null,
      },
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    const status = /must be/i.test(msg) || /already/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canEditProductContent } from "@/lib/product-permissions";
import {
  AGENT_BRIEF_MAX,
  AGENT_NOTES_MAX,
  VARIANT_NOTE_MAX,
} from "@/lib/products/agent-content-limits";

export const dynamic = "force-dynamic";

/**
 * The selling narrative an agent reads mid-call: description, the pinned
 * must-know, the internal notes, and the per-pack upsell lines.
 *
 * Separate from PATCH /api/products/[id] on purpose — that route is gated by
 * canManageProducts (super_admin only, stock-integrity lockdown). Content is
 * a weaker permission: market managers own the pitch for their own market but
 * still cannot touch costs, stock, name, sku or price. Writes go through
 * SECURITY DEFINER RPCs because the products UPDATE policy is SA-only.
 */

const TONES = new Set(["info", "warning", "critical"]);

function textOrNull(v: unknown, max: number): string | null | "invalid" {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return "invalid";
  const trimmed = v.trim();
  if (trimmed === "") return null;
  if (trimmed.length > max) return "invalid";
  return trimmed;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const supabase = await createClient();

  const { data: product, error: fetchError } = await supabase
    .from("products")
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (fetchError || !product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!canEditProductContent(actor.role, product.market_id, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const description = textOrNull(body.description, AGENT_NOTES_MAX);
  const agentBrief = textOrNull(body.agent_brief, AGENT_BRIEF_MAX);
  const agentNotes = textOrNull(body.agent_notes, AGENT_NOTES_MAX);

  if (description === "invalid") {
    return NextResponse.json({ error: "description too long" }, { status: 400 });
  }
  if (agentBrief === "invalid") {
    return NextResponse.json(
      { error: `agent_brief must be ${AGENT_BRIEF_MAX} characters or fewer` },
      { status: 400 },
    );
  }
  if (agentNotes === "invalid") {
    return NextResponse.json({ error: "agent_notes too long" }, { status: 400 });
  }

  const composition = textOrNull(body.agent_composition, AGENT_NOTES_MAX);
  const contraindications = textOrNull(body.agent_contraindications, AGENT_NOTES_MAX);
  const usage = textOrNull(body.agent_usage, AGENT_NOTES_MAX);

  for (const [name, value] of [
    ["agent_composition", composition],
    ["agent_contraindications", contraindications],
    ["agent_usage", usage],
  ] as const) {
    if (value === "invalid") {
      return NextResponse.json({ error: `${name} too long` }, { status: 400 });
    }
  }

  const tone = body.agent_brief_tone;
  if (tone !== undefined && tone !== null && (typeof tone !== "string" || !TONES.has(tone))) {
    return NextResponse.json({ error: "Invalid agent_brief_tone" }, { status: 400 });
  }

  const crossSellRaw = body.cross_sell_product_id;
  if (
    crossSellRaw !== undefined &&
    crossSellRaw !== null &&
    crossSellRaw !== "" &&
    typeof crossSellRaw !== "string"
  ) {
    return NextResponse.json({ error: "Invalid cross_sell_product_id" }, { status: 400 });
  }
  // The RPC enforces same-market and non-self; an empty string means "none".
  const crossSell = typeof crossSellRaw === "string" && crossSellRaw !== "" ? crossSellRaw : null;

  const { error: rpcError } = await supabase.rpc("update_product_agent_content", {
    p_product_id: id,
    p_description: description,
    p_agent_brief: agentBrief,
    p_agent_brief_tone: (tone as string | undefined) ?? null,
    p_agent_notes: agentNotes,
    p_agent_composition: composition,
    p_agent_contraindications: contraindications,
    p_agent_usage: usage,
    p_cross_sell_product_id: crossSell,
    p_actor_id: actor.id,
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 422 });
  }

  // Per-pack upsell lines. Sent together with the product content so the
  // manager saves the whole sheet in one action.
  const variantNotes = body.variant_notes;
  if (Array.isArray(variantNotes)) {
    for (const entry of variantNotes) {
      if (!entry || typeof entry !== "object") continue;
      const { id: variantId, agent_note: note } = entry as Record<string, unknown>;
      if (typeof variantId !== "string") continue;

      const cleaned = textOrNull(note, VARIANT_NOTE_MAX);
      if (cleaned === "invalid") {
        return NextResponse.json(
          { error: `variant note must be ${VARIANT_NOTE_MAX} characters or fewer` },
          { status: 400 },
        );
      }

      const { error: variantError } = await supabase.rpc("update_variant_agent_note", {
        p_variant_id: variantId,
        p_agent_note: cleaned,
        p_actor_id: actor.id,
      });

      if (variantError) {
        return NextResponse.json({ error: variantError.message }, { status: 422 });
      }
    }
  }

  return NextResponse.json({ success: true });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canToggleProductActive } from "@/lib/product-permissions";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canToggleProductActive(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { is_active } = body;
  if (typeof is_active !== "boolean") {
    return NextResponse.json(
      { error: "is_active must be a boolean" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase.rpc("toggle_product_active", {
    p_product_id: id,
    p_is_active: is_active,
    p_actor_id: actor.id,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("Market mismatch") || msg.includes("Not authorized")) {
      return NextResponse.json({ error: msg }, { status: 422 });
    }
    if (msg.includes("Product not found")) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ is_active: data });
}

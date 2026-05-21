import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { canManageProducts } from "@/lib/product-permissions";
import { getActor } from "@/lib/auth/actor";
import { uploadProductImageDataUrl } from "@/lib/product-images";

export const dynamic = "force-dynamic";

interface Body {
  data_url?: string;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const actorMarketId = actor.market_id ?? "";

  const { data: product, error: fetchError } = await supabase
    .from("products")
    .select("id, market_id, image_url")
    .eq("id", id)
    .single();

  if (fetchError || !product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  if (!canManageProducts(actor.role, product.market_id, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const dataUrl = body.data_url ?? "";
  const upload = await uploadProductImageDataUrl(
    product.market_id,
    product.id,
    dataUrl,
  );

  if (!upload.ok) {
    return NextResponse.json({ error: upload.error }, { status: upload.status });
  }

  const admin = createAdminClient();
  const { data: updated, error: updateError } = await admin
    .from("products")
    .update({ image_url: upload.url })
    .eq("id", id)
    .select("id, image_url")
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ image_url: updated.image_url });
}

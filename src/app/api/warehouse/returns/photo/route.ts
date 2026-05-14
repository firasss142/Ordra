import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { uploadImageDataUrl } from "@/lib/upload-image";

export const dynamic = "force-dynamic";

const BUCKET = "return-photos";
const MAX_BYTES = 4 * 1024 * 1024;
const SIGNED_URL_TTL = 60 * 60 * 24 * 7;

interface Body {
  order_id?: string;
  data_url?: string;
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = body.order_id?.trim();
  if (!orderId) {
    return NextResponse.json({ error: "Missing order_id" }, { status: 400 });
  }

  if (!actor.market_id && actor.role !== "super_admin") {
    return NextResponse.json(
      { error: "Actor has no market scope" },
      { status: 400 },
    );
  }

  const marketSegment = actor.market_id ?? "super_admin";
  const dataUrl = body.data_url ?? "";
  const ext = /^data:image\/([^;]+);/.exec(dataUrl)?.[1];
  if (!ext) {
    return NextResponse.json({ error: "Invalid data_url" }, { status: 400 });
  }
  const path = `${marketSegment}/${orderId}/${crypto.randomUUID()}.${ext}`;

  const result = await uploadImageDataUrl(dataUrl, {
    bucket: BUCKET,
    path,
    maxBytes: MAX_BYTES,
    signedUrlTtl: SIGNED_URL_TTL,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status },
    );
  }

  return NextResponse.json({
    path: result.path,
    signed_url: result.signedUrl,
    expires_in: SIGNED_URL_TTL,
  });
}

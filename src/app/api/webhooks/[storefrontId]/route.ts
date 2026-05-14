import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { handleWebhook } from "@/lib/orders/webhook-handler";
import { CORS_HEADERS, withCorsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ storefrontId: string }> }
) {
  const { storefrontId } = await params;
  const rawBody = await request.text();
  const adminClient = createAdminClient();

  const result = await handleWebhook({
    storefrontId,
    rawBody,
    headers: request.headers,
    adminClient,
    decryptFn: decrypt,
  });

  return withCorsHeaders(NextResponse.json(result.body, { status: result.status }));
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function methodNotAllowed() {
  return withCorsHeaders(
    NextResponse.json({ error: "Method not allowed" }, { status: 405 })
  );
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;

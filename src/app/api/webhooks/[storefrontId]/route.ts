import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { handleWebhook } from "@/lib/orders/webhook-handler";

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

  return NextResponse.json(result.body, { status: result.status });
}

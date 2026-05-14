import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import {
  validateScanReturnBody,
  type ScanReturnInput,
} from "@/lib/warehouse/returns-validation";

export const dynamic = "force-dynamic";

const MAX_BATCH_SIZE = 50;

interface BatchBody {
  items?: ScanReturnInput[];
}

interface BatchResult {
  order_id: string;
  ok: boolean;
  error?: string;
  balance_after?: number;
  is_damaged?: boolean;
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: BatchBody;
  try {
    body = (await req.json()) as BatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) {
    return NextResponse.json(
      { error: "items must be a non-empty array" },
      { status: 400 },
    );
  }
  if (items.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Batch too large (max ${MAX_BATCH_SIZE})` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const results: BatchResult[] = [];

  for (const raw of items) {
    const parsed = validateScanReturnBody(raw);
    if (!parsed.ok) {
      results.push({
        order_id: raw.order_id ?? "",
        ok: false,
        error: parsed.error,
      });
      continue;
    }

    const { data, error } = await supabase.rpc("scan_return_in", {
      p_order_id: parsed.data.order_id,
      p_actor_id: actor.id,
      p_is_damaged: parsed.data.is_damaged,
      p_return_reason: parsed.data.return_reason,
      p_return_photo_url: parsed.data.return_photo_url,
      p_return_reason_note: parsed.data.return_reason_note,
    });

    if (error) {
      results.push({
        order_id: parsed.data.order_id,
        ok: false,
        error: error.message,
      });
      continue;
    }

    const payload = (data ?? {}) as {
      balance_after?: number;
      is_damaged?: boolean;
    };
    results.push({
      order_id: parsed.data.order_id,
      ok: true,
      balance_after: payload.balance_after,
      is_damaged: payload.is_damaged,
    });
  }

  const succeeded = results.filter((r) => r.ok).length;
  return NextResponse.json({
    results,
    summary: {
      total: results.length,
      succeeded,
      failed: results.length - succeeded,
    },
  });
}

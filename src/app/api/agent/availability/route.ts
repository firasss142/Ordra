import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { isReadyForOrders } from "@/lib/orders/agent-readiness";

export const dynamic = "force-dynamic";

/**
 * The agent's own "I am taking orders" switch.
 *
 * Readiness is two things at once: the declaration stored here, and a fresh
 * heartbeat. GET returns both plus the derived answer, so the UI never has to
 * re-derive it and drift from what the distributor actually does.
 *
 * The write goes through `set_agent_availability`, never a direct UPDATE: the
 * column grant added in 20261003000002 allows `authenticated` to write only
 * `last_seen_at`, so the audit log and the release of untouched orders cannot
 * be bypassed by a direct PostgREST call.
 */

interface ToggleBody {
  is_available?: unknown;
  /** A manager or super_admin forcing someone else off. Defaults to self. */
  agent_id?: unknown;
  reason?: unknown;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, is_available, available_since, last_seen_at, is_active, deleted_at")
    .eq("id", actor.id)
    .single();

  if (error || !data) {
    console.error("[GET /api/agent/availability] read failed", {
      code: error?.code,
      message: error?.message,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const row = data as {
    id: string;
    is_available: boolean | null;
    available_since: string | null;
    last_seen_at: string | null;
    is_active: boolean;
    deleted_at: string | null;
  };

  // Reuse the distributor's own predicate rather than restating it here. A
  // second definition would eventually disagree, and the agent would be told
  // they are receiving work while nothing arrived.
  const ready = isReadyForOrders(
    {
      id: row.id,
      queue_size: 0,
      last_action_at: null,
      assigned_today: 0,
      is_available: row.is_available ?? false,
      is_active: row.is_active,
      deleted_at: row.deleted_at,
      last_seen_at: row.last_seen_at,
    },
    new Date(),
  );

  return NextResponse.json({
    data: {
      is_available: row.is_available ?? false,
      available_since: row.available_since,
      last_seen_at: row.last_seen_at,
      /** Declared AND beating. What the distributor actually checks. */
      receiving_orders: ready,
    },
  });
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  let body: ToggleBody;
  try {
    body = (await req.json()) as ToggleBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.is_available !== "boolean") {
    return NextResponse.json({ error: "is_available must be a boolean" }, { status: 400 });
  }

  const targetId =
    typeof body.agent_id === "string" && body.agent_id.length > 0 ? body.agent_id : actor.id;

  const reason =
    typeof body.reason === "string" && body.reason.length > 0 ? body.reason.slice(0, 200) : null;

  const supabase = await createClient();
  // Every authorisation rule lives in the RPC — self, manager-in-market, or
  // super_admin — so there is one place to read them and one place they can be
  // wrong. The route does not second-guess it.
  const { data, error } = await supabase.rpc("set_agent_availability", {
    p_agent_id: targetId,
    p_available: body.is_available,
    p_actor_id: actor.id,
    p_reason: reason,
  });

  if (error) {
    const detail = structuredCode(error.details);
    const status = RPC_CODE_STATUS[detail ?? ""] ?? 500;
    if (status === 500) {
      console.error("[POST /api/agent/availability] rpc failed", {
        code: error.code,
        message: error.message,
        details: error.details,
      });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return NextResponse.json({ error: error.message, code: detail }, { status });
  }

  return NextResponse.json({ data });
}

/** Maps the RPC's machine-readable DETAIL codes onto HTTP, per scan-out. */
const RPC_CODE_STATUS: Record<string, number> = {
  ACTOR_MISMATCH: 403,
  FORBIDDEN: 403,
  ACTOR_NOT_FOUND: 404,
  AGENT_NOT_FOUND: 404,
  NOT_AN_AGENT: 400,
  AGENT_INACTIVE: 409,
};

function structuredCode(details: string | null | undefined): string | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as { code?: string };
    return parsed.code ?? null;
  } catch {
    return null;
  }
}

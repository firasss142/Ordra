import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { Role } from "@/types";

export interface Actor {
  id: string;
  role: Role;
  market_id: string | null;
}

type ActorError = { response: ReturnType<typeof NextResponse.json> };

/**
 * Reads the x-oms-role / x-oms-actor-id / x-oms-market-id headers injected by
 * middleware (when the oms_profile cookie cache is warm) or falls back to a
 * fresh Supabase auth.getUser() + users.select() query.
 *
 * Returns { actor } on success, or { response } (a 401/500) to return early.
 */
export async function getActor(
  req: Request
): Promise<{ actor: Actor } | ActorError> {
  const headers = req instanceof Request ? req.headers : new Headers();

  const headerRole = headers.get("x-oms-role") as Role | null;
  const headerActorId = headers.get("x-oms-actor-id");
  const headerMarketId = headers.get("x-oms-market-id");

  if (headerRole && headerActorId) {
    return {
      actor: {
        id: headerActorId,
        role: headerRole,
        market_id: headerMarketId || null,
      },
    };
  }

  // Fallback: full DB round-trip (cold cache or missing headers)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data } = await supabase
    .from("users")
    .select("role, market_id")
    .eq("id", user.id)
    .single();

  if (!data) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return {
    actor: {
      id: user.id,
      role: data.role as Role,
      market_id: data.market_id ?? null,
    },
  };
}

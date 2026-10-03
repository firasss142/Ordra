import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

/**
 * Journaux is the super_admin's (decided with Réglages). The read functions
 * check it again inside the database; this answers 403 before any query.
 */
export async function journalSession(
  req: NextRequest,
): Promise<{ supabase: SupabaseClient; actorId: string } | { response: Response }> {
  const result = await getActor(req);
  if ("response" in result) return { response: result.response };
  if (result.actor.role !== "super_admin") {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { supabase: (await createClient()) as unknown as SupabaseClient, actorId: result.actor.id };
}

/** A database refusal (42501) is a 403; anything else is a 500 the wrapper records. */
export function rpcFailure(error: { message?: string; code?: string }): Response {
  if (error.code === "42501") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({ error: error.message ?? "Journal unavailable", code: error.code }, { status: 500 });
}

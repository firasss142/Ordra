import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { PROFILE_COOKIE, verifyProfile } from "@/lib/auth/profile-cookie";
import type { Role } from "@/types";

export interface Actor {
  id: string;
  role: Role;
  market_id: string | null;
}

type ActorError = { response: ReturnType<typeof NextResponse.json> };

function unauthorized(): ActorError {
  return {
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}

/**
 * Resolves the acting user for an API route.
 *
 * Fast path: the HMAC-signed `oms_profile` cookie issued by middleware (zero
 * network calls). Cold path: `auth.getUser()` + a `users` lookup.
 *
 * SECURITY — request headers are never an identity source. An earlier version
 * read `x-oms-role` / `x-oms-actor-id` / `x-oms-market-id` straight off the
 * request, described as "injected by middleware". Middleware never set them and
 * its matcher excludes `/api/*` entirely, so any authenticated caller could send
 * `x-oms-role: super_admin` to the ~165 routes using this helper — several of
 * which then use the service-role client and bypass RLS. Identity now comes only
 * from the signed cookie or the session.
 *
 * The cookie carries no `is_active` flag because middleware only issues it to an
 * active, non-deleted user and it expires after PROFILE_TTL_MS (5 min). Combined
 * with revoking the auth session on deactivation, that bounds how long a
 * deactivated account can keep acting.
 */
export async function getActor(
  _req?: Request
): Promise<{ actor: Actor } | ActorError> {
  // Fast path — signed profile cookie.
  try {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(PROFILE_COOKIE)?.value;
    if (cookieValue) {
      const payload = await verifyProfile(cookieValue);
      if (payload) {
        return {
          actor: {
            id: payload.user_id,
            role: payload.role,
            market_id: payload.market_id,
          },
        };
      }
    }
  } catch {
    // Unreadable cookie store or a missing/rotated ENCRYPTION_KEY must degrade
    // to the session lookup, not 500 every API route.
  }

  // Cold path — full session + profile round-trip.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return unauthorized();

  const { data } = await supabase
    .from("users")
    .select("role, market_id, is_active, deleted_at")
    .eq("id", user.id)
    .single();

  if (!data || data.is_active === false || data.deleted_at) {
    return unauthorized();
  }

  return {
    actor: {
      id: user.id,
      role: data.role as Role,
      market_id: data.market_id ?? null,
    },
  };
}

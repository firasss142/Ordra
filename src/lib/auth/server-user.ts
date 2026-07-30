import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  getDirectionForLocale,
  getLocaleForMarket,
} from "@/lib/locale-routing";
import {
  PROFILE_COOKIE,
  type ProfilePayload,
  verifyProfile,
} from "@/lib/auth/profile-cookie";
import type { AuthUser, Role } from "@/types";

const LY_MARKET_ID = "00000000-0000-0000-0000-000000000002";

function authUserFromPayload(p: ProfilePayload): AuthUser {
  const locale = getLocaleForMarket(p.market_code);
  return {
    id: p.user_id,
    email: p.email,
    full_name: p.full_name,
    avatar_url: p.avatar_url,
    role: p.role,
    market_id: p.market_id,
    locale,
    direction: getDirectionForLocale(locale),
  };
}

export const getServerUser = cache(async (): Promise<AuthUser | null> => {
  // Fast path: signed oms_profile cookie set by middleware. Zero network calls.
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(PROFILE_COOKIE)?.value;
  if (cookieValue) {
    const payload = await verifyProfile(cookieValue);
    if (payload) return authUserFromPayload(payload);
  }

  // Cold path: cookie missing or expired (e.g. first request after login).
  // Middleware will (re)issue the cookie on the response; we still need user data now.
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const { data } = await supabase
    .from("users")
    .select("full_name, avatar_url, role, market_id, is_active, deleted_at")
    .eq("id", authUser.id)
    .single();
  // A deactivated or soft-deleted account resolves to "no user", so every page
  // guard that redirects on a null user also covers account status.
  if (!data || data.is_active === false || data.deleted_at) return null;

  const marketCode =
    data.market_id === LY_MARKET_ID ? "ly" : data.market_id ? "tn" : null;
  const locale = getLocaleForMarket(marketCode);

  return {
    id: authUser.id,
    email: authUser.email ?? "",
    full_name: data.full_name,
    avatar_url: data.avatar_url ?? null,
    role: data.role as Role,
    market_id: data.market_id,
    locale,
    direction: getDirectionForLocale(locale),
  };
});

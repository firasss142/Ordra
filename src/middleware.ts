import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { canAccess } from "@/lib/role-permissions";
import { getLocaleForMarket } from "@/lib/locale-routing";
import {
  PROFILE_COOKIE,
  PROFILE_TTL_MS,
  signProfile,
  verifyProfile,
  type ProfilePayload,
} from "@/lib/auth/profile-cookie";

const PUBLIC_PATHS = ["/login", "/auth/callback"];
// webmanifest included: a PWA manifest redirected to /login is an HTML body
// the browser reports as "Manifest: syntax error", and the install prompt dies.
const STATIC_EXT = /\.(svg|png|jpg|jpeg|webp|woff2|map|txt|ico|webmanifest)$/;

// Vercel kills a middleware invocation that hasn't responded within 25s. Every
// Supabase call below shares this timeout so a slow/degraded Auth API fails
// fast and redirects to login instead of hanging the whole site until Vercel
// kills it (see the 2026-08-24 outage: GoTrue /user took up to 97s to respond).
const SUPABASE_FETCH_TIMEOUT_MS = 6000;

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(SUPABASE_FETCH_TIMEOUT_MS) });
}

function getRoleHome(role: string, locale: string): string {
  if (role === "agent") return `/${locale}/queue`;
  if (role === "warehouse_agent") return `/${locale}/warehouse`;
  if (role === "investor") return `/${locale}/investor`;
  return `/${locale}/dashboard`;
}

// The only paths an investor may reach. Everything else in the OMS bounces.
//
// /profile is deliberately NOT here. It lives in the (dashboard) route group,
// whose layout renders the full staff Sidebar — Commandes, Logistique,
// Clients, Équipe — so allowing it disclosed the entire internal information
// architecture to an external user. The investor portal has its own account
// page at /investor/account instead.
const INVESTOR_ALLOWED_PREFIXES = ["/investor"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static assets early
  if (STATIC_EXT.test(pathname)) {
    return NextResponse.next({ request });
  }

  // Extract locale segment from path: /fr/... or /ar/...
  const localeMatch = pathname.match(/^\/(fr|ar)(\/|$)/);
  const pathWithoutLocale = localeMatch
    ? pathname.slice(localeMatch[1].length + 1) || "/"
    : pathname;

  // Allow public paths (under any locale or without locale) before touching
  // Supabase at all — the login page must keep working even when Auth is down.
  if (
    PUBLIC_PATHS.some(
      (p) => pathWithoutLocale === p || pathWithoutLocale.startsWith(p + "/"),
    )
  ) {
    return NextResponse.next({ request });
  }

  // Build a response we can mutate (for cookie refresh)
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: fetchWithTimeout },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session (no-op if still valid, refreshes if near expiry). A slow
  // or unreachable Auth API is bounded by fetchWithTimeout above and treated
  // as "no session" rather than hanging the request.
  let user: { id: string; email?: string } | null = null;
  try {
    const {
      data: { user: fetchedUser },
    } = await supabase.auth.getUser();
    user = fetchedUser;
  } catch {
    user = null;
  }

  // No session → redirect to login (preserve locale if present)
  if (!user) {
    const locale = localeMatch ? localeMatch[1] : "fr";
    const loginUrl = new URL(`/${locale}/login`, request.url);
    return NextResponse.redirect(loginUrl);
  }

  // --- oms_profile cookie cache ---
  let role: ProfilePayload["role"];
  let market_id: string | null;
  let marketCode: "tn" | "ly" | null;

  const existingCookie = request.cookies.get(PROFILE_COOKIE)?.value;
  const cached = existingCookie ? await verifyProfile(existingCookie) : null;

  if (cached && cached.user_id === user.id) {
    role = cached.role;
    market_id = cached.market_id;
    marketCode = cached.market_code;
  } else {
    type UserRecord = {
      role: ProfilePayload["role"];
      market_id: string | null;
      full_name: string;
      avatar_url: string | null;
      is_active: boolean | null;
      deleted_at: string | null;
      markets: { code: string } | { code: string }[] | null;
    };

    let record: UserRecord | null = null;
    try {
      const { data: userRecord } = await supabase
        .from("users")
        .select(
          "role, market_id, full_name, avatar_url, is_active, deleted_at, markets(code)",
        )
        .eq("id", user.id)
        .single();
      record = userRecord as unknown as UserRecord | null;
    } catch {
      // Timed out or unreachable — fall through to the fail-closed redirect below.
      record = null;
    }

    // Deactivated / soft-deleted accounts must not hold a session. This runs on
    // every profile-cookie refresh, so a deactivation takes effect within
    // PROFILE_TTL_MS at worst — and immediately for anyone without a warm cookie.
    // A Supabase timeout lands here too (record stays null) — fail closed rather
    // than let the middleware hang until Vercel's own 25s cap kills it.
    if (!record || record.is_active === false || record.deleted_at) {
      const locale = localeMatch ? localeMatch[1] : "fr";
      const redirect = NextResponse.redirect(
        new URL(`/${locale}/login`, request.url),
      );
      try {
        await supabase.auth.signOut();
        // Carry the cleared auth cookies from signOut onto the redirect response.
        response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
      } catch {
        // Best-effort sign-out; still force the redirect below.
      }
      redirect.cookies.set(PROFILE_COOKIE, "", { path: "/", maxAge: 0 });
      return redirect;
    }
    role = record.role;
    market_id = record.market_id;
    const marketsData = Array.isArray(record.markets)
      ? record.markets[0]
      : record.markets;
    marketCode = (marketsData?.code ?? null) as "tn" | "ly" | null;

    const payload: ProfilePayload = {
      user_id: user.id,
      email: user.email ?? "",
      full_name: record.full_name,
      avatar_url: record.avatar_url ?? null,
      role,
      market_id,
      market_code: marketCode,
      exp: Date.now() + PROFILE_TTL_MS,
    };
    const signed = await signProfile(payload);
    response.cookies.set(PROFILE_COOKIE, signed, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 300,
      secure: process.env.NODE_ENV === "production",
    });
  }

  const correctLocale = getLocaleForMarket(marketCode);

  // If no locale in path yet, redirect to locale-prefixed root
  if (!localeMatch) {
    return NextResponse.redirect(new URL(getRoleHome(role, correctLocale), request.url));
  }

  // Enforce correct locale for user's market
  const currentLocale = localeMatch[1];
  if (currentLocale !== correctLocale) {
    const corrected = pathname.replace(
      new RegExp(`^/${currentLocale}`),
      `/${correctLocale}`,
    );
    return NextResponse.redirect(new URL(corrected, request.url));
  }

  // Route guard — check canAccess for the path segment
  const routeSegment = pathWithoutLocale === "/" ? "/" : pathWithoutLocale;

  // Redirect "/" to the role's home page
  if (routeSegment === "/") {
    return NextResponse.redirect(new URL(getRoleHome(role, correctLocale), request.url));
  }

  // Investors are external users, so they get a deny-by-default containment
  // rule rather than being added to the opt-in `knownRoutes` list below.
  //
  // That list omits /dashboard, /in-delivery, /follow-ups, /mappings, /finance,
  // /admin, /confirmation-flow and /markets, and those pages guard with DENIAL
  // lists naming agent/warehouse_agent explicitly. A fifth role would fall
  // straight through into manager pages. Checking an allow-list here closes
  // every one of them at once, without touching the other roles' routing.
  if (role === "investor") {
    const allowed = INVESTOR_ALLOWED_PREFIXES.some(
      (p) => routeSegment === p || routeSegment.startsWith(p + "/"),
    );
    if (!allowed) {
      return NextResponse.redirect(
        new URL(`/${correctLocale}/investor`, request.url),
      );
    }
    return response;
  }

  // Redirect agents away from dashboard
  if (routeSegment === "/dashboard" && role === "agent") {
    return NextResponse.redirect(
      new URL(`/${correctLocale}/queue`, request.url),
    );
  }

  // Redirect warehouse_agent away from dashboard
  if (routeSegment === "/dashboard" && role === "warehouse_agent") {
    return NextResponse.redirect(
      new URL(`/${correctLocale}/warehouse`, request.url),
    );
  }

  // Check permission for known protected routes
  const knownRoutes = [
    "/orders",
    "/unassigned",
    "/products",
    "/team",
    "/users",
    "/carriers",
    "/settings",
    "/queue",
    "/leads",
    "/warehouse",
  ];
  const matchedRoute = knownRoutes.find((r) => routeSegment.startsWith(r));
  if (matchedRoute && !canAccess(role, matchedRoute)) {
    return NextResponse.redirect(new URL(getRoleHome(role, correctLocale), request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};

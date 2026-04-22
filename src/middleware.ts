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
const STATIC_EXT = /\.(svg|png|jpg|jpeg|webp|woff2|map|txt|ico)$/;

function getRoleHome(role: string, locale: string): string {
  if (role === "agent") return `/${locale}/queue`;
  if (role === "warehouse_agent") return `/${locale}/warehouse`;
  return `/${locale}/dashboard`;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip static assets early
  if (STATIC_EXT.test(pathname)) {
    return NextResponse.next({ request });
  }

  // Build a response we can mutate (for cookie refresh)
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

  // Refresh session (no-op if still valid, refreshes if near expiry)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Extract locale segment from path: /fr/... or /ar/...
  const localeMatch = pathname.match(/^\/(fr|ar)(\/|$)/);
  const pathWithoutLocale = localeMatch
    ? pathname.slice(localeMatch[1].length + 1) || "/"
    : pathname;

  // Allow public paths (under any locale or without locale)
  if (
    PUBLIC_PATHS.some(
      (p) => pathWithoutLocale === p || pathWithoutLocale.startsWith(p + "/"),
    )
  ) {
    return response;
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
    const { data: userRecord } = await supabase
      .from("users")
      .select("role, market_id, full_name, avatar_url, markets(code)")
      .eq("id", user.id)
      .single();

    if (!userRecord) {
      const loginUrl = new URL("/fr/login", request.url);
      return NextResponse.redirect(loginUrl);
    }

    const record = userRecord as unknown as {
      role: ProfilePayload["role"];
      market_id: string | null;
      full_name: string;
      avatar_url: string | null;
      markets: { code: string } | { code: string }[] | null;
    };
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

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageInvestments, canViewInvestorAdmin } from "@/lib/investor-permissions";
import { loadInvestorMoneySummaries } from "@/lib/investors/admin-summary";

export const dynamic = "force-dynamic";

const PAYOUT_METHODS = ["bank_transfer", "cash", "wallet"] as const;

/**
 * Investor profiles.
 *
 * A login and a profile are two different things. `POST /api/users` creates the
 * user with role='investor'; the `investors` row holds the commercial terms —
 * legal name, payout method, notes. Nothing could write that row,
 * so a freshly created investor logged in to "Votre profil investisseur n'est
 * pas encore configuré" and there was no way out of that state.
 *
 * The list deliberately starts from USERS, not from investors, so a
 * half-configured account is visible instead of silently absent.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewInvestorAdmin(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  let userQuery = admin
    .from("users")
    .select("id, email, full_name, market_id, is_active")
    .eq("role", "investor")
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  // A market_manager sees only their own market's investors.
  if (actor.role === "market_manager") {
    userQuery = userQuery.eq("market_id", actor.market_id ?? "");
  }

  const { data: users, error: userError } = await userQuery;

  if (userError) {
    console.error("[GET /api/admin/investments/investors] users:", userError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const ids = (users ?? []).map((u) => u.id as string);

  const { data: profiles, error: profileError } = ids.length
    ? await admin
        .from("investors")
        .select("id, legal_name, payout_method, payout_details, notes")
        .in("id", ids)
    : { data: [], error: null };

  if (profileError) {
    console.error("[GET /api/admin/investments/investors] profiles:", profileError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const byId = new Map(
    ((profiles ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, p])
  );

  const money = await loadInvestorMoneySummaries(admin, ids);

  const data = (users ?? []).map((u) => {
    const profile = byId.get(u.id as string);
    return {
      money: money.get(u.id as string) ?? null,
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      market_id: u.market_id,
      is_active: u.is_active,
      configured: Boolean(profile),
      legal_name: (profile?.legal_name as string) ?? null,
      payout_method: (profile?.payout_method as string) ?? null,
      payout_details: profile?.payout_details ?? null,
      notes: (profile?.notes as string) ?? null,
    };
  });

  return NextResponse.json({ data });
}

/** Create the profile row for an existing investor user. */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageInvestments(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = String(body.user_id ?? "");
  const legalName = typeof body.legal_name === "string" ? body.legal_name.trim() : "";
  const payoutMethod = String(body.payout_method ?? "bank_transfer");

  if (!userId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }
  if (!legalName) {
    return NextResponse.json({ error: "legal_name is required" }, { status: 400 });
  }
  if (!PAYOUT_METHODS.includes(payoutMethod as (typeof PAYOUT_METHODS)[number])) {
    return NextResponse.json(
      { error: `payout_method must be one of ${PAYOUT_METHODS.join(", ")}` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: user } = await admin
    .from("users")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  // The profile is meaningless on any other role, and creating one would give
  // a staff account an investor identity in the ledger.
  if (user.role !== "investor") {
    return NextResponse.json(
      { error: "User does not have the investor role" },
      { status: 422 }
    );
  }

  const { data, error } = await admin
    .from("investors")
    .insert({
      id: userId,
      legal_name: legalName.slice(0, 200),
      payout_method: payoutMethod,
      payout_details: body.payout_details ?? null,
      notes: typeof body.notes === "string" ? body.notes.slice(0, 1000) : null,
    })
    .select("id, legal_name, payout_method")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "This investor is already configured" }, { status: 409 });
    }
    console.error("[POST /api/admin/investments/investors]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}

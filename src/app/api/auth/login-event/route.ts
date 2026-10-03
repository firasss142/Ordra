import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { withRouteErrors } from "@/lib/journal/route-errors";
import {
  ipHash,
  maskEmail,
  accountKey,
  LOGIN_FAILURES_MAX,
  LOGIN_FAILURES_WINDOW_MIN,
} from "@/lib/journal/login-event";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/login-event  { email, ok }
 *
 * Fired (and forgotten) by the login page after signInWithPassword. A success
 * is recorded through the caller's own session (journal_record allows
 * `auth.login` for authenticated), labelled with the SESSION's e-mail. A
 * failure has no session, so the service role records `auth.login_failed`,
 * at most LOGIN_FAILURES_MAX per account (hash of the full address) per window, so the endpoint
 * cannot be used to flood the journal.
 *
 * Always 204 with an empty body: valid or not, recorded or not, it says
 * nothing about accounts.
 */
async function handlePOST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as { email?: unknown; ok?: unknown } | null;
    const email = body?.email;
    const ok = body?.ok;
    if (typeof ok !== "boolean" || typeof email !== "string" || email.length > 254 || !email.includes("@")) {
      return noContent();
    }

    if (ok) {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user) return noContent();
      await supabase.rpc("journal_record", {
        p_action: "auth.login",
        p_entity_type: "auth",
        p_entity_id: user.id,
        p_entity_label: maskEmail(user.email ?? email),
        p_context: {},
      });
      return noContent();
    }

    const label = maskEmail(email);
    const account = accountKey(email);
    const admin = createAdminClient();
    const since = new Date(Date.now() - LOGIN_FAILURES_WINDOW_MIN * 60_000).toISOString();
    const { count, error } = await admin
      .from("audit_events")
      .select("id", { count: "exact", head: true })
      .eq("action", "auth.login_failed")
      .eq("entity_id", account)
      .gte("occurred_at", since);
    if (error || count == null || count >= LOGIN_FAILURES_MAX) return noContent();

    await admin.rpc("journal_record", {
      p_action: "auth.login_failed",
      p_entity_type: "auth",
      p_entity_id: account,
      p_entity_label: label,
      p_context: { ip_hash: ipHash(req.headers.get("x-forwarded-for")) },
    });
  } catch {
    // Never reveal anything, never fail a sign-in screen.
  }
  return noContent();
}

function noContent() {
  return new NextResponse(null, { status: 204 });
}

export const POST = withRouteErrors("/api/auth/login-event", "POST", handlePOST);

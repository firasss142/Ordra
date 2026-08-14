import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { decrypt } from "@/lib/crypto";
import { fetchAccountMeta, fetchCampaignInsights, MetaApiError } from "@/lib/meta-ads/client";
import { checkTimezone } from "@/lib/meta-ads/timezone";

/**
 * Staged connection test, on the pattern of /api/storefronts/[id]/test.
 *
 * Staged rather than pass/fail because the four things that can go wrong need
 * four different fixes, and a single red cross sends the operator back to Meta
 * to re-do all of them. Reading the account proves the token; reading insights
 * proves the ad-account assignment (a token can be valid and still be denied
 * View performance); the timezone stage proves the days line up, which nothing
 * else will ever tell you.
 *
 * The token is decrypted here and never leaves: no stage returns it, and every
 * Meta error is already redacted inside the client.
 */

export const dynamic = "force-dynamic";

type StageStatus = "ok" | "warning" | "failed" | "skipped";

interface Stage {
  key: string;
  status: StageStatus;
  detail: string;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const adminClient = createAdminClient();
  const { data: account, error } = await adminClient
    .from("meta_ad_accounts")
    .select("id, market_id, ad_account_id, graph_version, access_token, markets(code, name)")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!account) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const marketCode =
    (account.markets as unknown as { code?: string } | null)?.code ?? "";

  const stages: Stage[] = [];

  let token: string;
  try {
    token = decrypt(account.access_token);
    stages.push({ key: "credentials", status: "ok", detail: "Token decrypted" });
  } catch {
    // Almost always a rotated ENCRYPTION_KEY rather than a corrupt row, and it
    // is worth saying so: re-pasting the token fixes it, hunting the database
    // does not.
    stages.push({
      key: "credentials",
      status: "failed",
      detail: "Stored token could not be decrypted — ENCRYPTION_KEY may have changed. Re-enter the token.",
    });
    return NextResponse.json({ data: { ok: false, stages } });
  }

  const cfg = {
    adAccountId: account.ad_account_id,
    accessToken: token,
    graphVersion: account.graph_version,
  };

  let accountName: string | null = null;
  let accountTimezone: string | null = null;
  let accountCurrency: string | null = null;

  try {
    const meta = await fetchAccountMeta(cfg);
    accountName = meta.name;
    accountTimezone = meta.timezoneName;
    accountCurrency = meta.currency;
    stages.push({
      key: "account",
      status: "ok",
      detail: `${meta.name} · ${meta.currency}`,
    });
  } catch (err) {
    const apiError = err instanceof MetaApiError ? err : null;
    stages.push({
      key: "account",
      status: "failed",
      detail: apiError?.isAuthFailure
        ? "Token rejected (code 190). Generate a new System User token."
        : err instanceof Error
          ? err.message
          : "Could not reach Meta",
    });
    stages.push({ key: "insights", status: "skipped", detail: "" });
    stages.push({ key: "timezone", status: "skipped", detail: "" });
    return NextResponse.json({ data: { ok: false, stages } });
  }

  // Yesterday only. Enough to prove the permission and the parse without
  // spending rate-limit budget the hourly sync needs.
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  try {
    const result = await fetchCampaignInsights(cfg, { since: day, until: day });
    stages.push({
      key: "insights",
      status: "ok",
      detail:
        result.rows.length > 0
          ? `${result.rows.length} campaign row(s) for ${day}`
          : `Readable — no campaign ran on ${day}`,
    });
  } catch (err) {
    const apiError = err instanceof MetaApiError ? err : null;
    stages.push({
      key: "insights",
      status: apiError?.isThrottle ? "warning" : "failed",
      detail: apiError?.isThrottle
        ? "Rate limited right now — the credential is fine, retry in a few minutes."
        : err instanceof Error
          ? err.message
          : "Insights unreadable",
    });
  }

  // The stage that cannot be fixed later.
  const tz = checkTimezone(accountTimezone, marketCode);
  stages.push({
    key: "timezone",
    status: tz.status === "ok" ? "ok" : "warning",
    detail:
      tz.status === "ok"
        ? `${tz.accountTimezone} — aligned with the market`
        : tz.status === "mismatch"
          ? `${tz.accountTimezone} is ${Math.abs(tz.offsetHours ?? 0)}h from ${tz.expectedTimezone}. Meta cuts its reporting days there, so daily spend will not line up with daily leads. Change it in Meta before the first sync — history cannot be re-reported.`
          : `Could not compare ${tz.accountTimezone ?? "the account timezone"} with this market.`,
  });

  // Persist what the probe learned. It is the freshest reading available and
  // the account may have been edited in Meta since it was connected.
  await adminClient
    .from("meta_ad_accounts")
    .update({
      account_name: accountName,
      account_currency: accountCurrency ?? undefined,
      account_timezone: accountTimezone,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);

  return NextResponse.json({
    data: {
      ok: !stages.some((s) => s.status === "failed"),
      stages,
      timezone: tz,
    },
  });
}

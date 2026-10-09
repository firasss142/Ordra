import { NextRequest, NextResponse } from "next/server";
import { journalSession, rpcFailure } from "@/lib/journal/guard";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { validateRulePatch } from "@/lib/journal/rule-settings";

export const dynamic = "force-dynamic";

/**
 * GET   /api/admin/journal/rules — every detector rule, on/off and thresholds.
 * PATCH /api/admin/journal/rules — { rule_key, enabled?, params? } for one rule.
 * super_admin only (the guard here, RLS + column grants in the database).
 * Written with the session client, so the audit names the person.
 */
async function handleGET(req: NextRequest) {
  const s = await journalSession(req);
  if ("response" in s) return s.response;
  const { data, error } = await s.supabase
    .from("journal_rule_settings")
    .select("rule_key, enabled, params, updated_at, updated_by")
    .order("rule_key");
  if (error) return rpcFailure(error);
  return NextResponse.json({ data: data ?? [] });
}

async function handlePATCH(req: NextRequest) {
  const s = await journalSession(req);
  if ("response" in s) return s.response;

  let body: { rule_key?: unknown; enabled?: unknown; params?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const rule = typeof body?.rule_key === "string" ? body.rule_key : "";
  const checked = validateRulePatch(rule, body ?? {});
  if (!checked.ok) return NextResponse.json({ error: checked.error, field: checked.field ?? null }, { status: 422 });

  const { data, error } = await s.supabase
    .from("journal_rule_settings")
    .update({ ...checked.value, updated_at: new Date().toISOString(), updated_by: s.actorId })
    .eq("rule_key", rule)
    .select("rule_key, enabled, params, updated_at, updated_by")
    .maybeSingle();
  if (error) return rpcFailure(error);
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ data });
}

export const GET = withRouteErrors("/api/admin/journal/rules", "GET", handleGET);
export const PATCH = withRouteErrors("/api/admin/journal/rules", "PATCH", handlePATCH);

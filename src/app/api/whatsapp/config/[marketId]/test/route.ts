import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import { classifyGraphError, WhatsAppApiError } from "@/lib/whatsapp/errors";
import { CONFIG_COLUMNS, fromRow, toPublicConfig, type ConfigRow } from "@/lib/whatsapp/config";

/**
 * Staged connection test, on the pattern of /api/meta/accounts/[id]/test.
 *
 * Five stages because five things go wrong on a fresh setup and each has a
 * different fix: the row cannot be decrypted (ENCRYPTION_KEY rotated), the
 * token or the phone number id is wrong (Meta console), the WABA is not the
 * one the number belongs to, the app is not subscribed to the WABA (fixed
 * here, automatically), and no webhook has ever arrived (the callback URL in
 * the Meta app, or the verify token). One red cross would send the operator
 * back to Meta to redo all five.
 *
 * Every stage carries a `code` + `params` for the card to translate (the
 * French `detail` stays as the fallback and for logs), and the whole run is
 * persisted on the row (`last_test_*`) so the checklist is still there after
 * a reload — the failed run is precisely the one someone wants to read again.
 *
 * Nothing here returns a secret; every Meta error is redacted in the client.
 */

export const dynamic = "force-dynamic";

type StageStatus = "ok" | "warning" | "failed" | "skipped";
type StageKey = "credentials" | "phone" | "waba" | "subscription" | "webhook";
type Params = Record<string, string | number>;
interface Cause {
  code: string;
  params?: Params;
}
interface Stage {
  key: StageKey;
  status: StageStatus;
  detail: string;
  code?: string;
  /** Interpolation values; `cause` nests the Graph failure behind a WABA stage. */
  params?: Record<string, string | number | Cause>;
}

const WEBHOOK_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const STAGE_KEYS: StageKey[] = ["credentials", "phone", "waba", "subscription", "webhook"];

/** A Graph failure as a translatable cause, plus the French sentence. */
function graphCause(err: unknown): { cause: Cause; text: string } {
  const cls = classifyGraphError(err);
  const code = err instanceof WhatsAppApiError ? err.code : null;
  if (cls.kind === "auth") {
    const c = code ?? 190;
    return { cause: { code: "graph_auth", params: { code: c } }, text: `Jeton refusé (code ${c}). Générez un nouveau jeton System User.` };
  }
  if (cls.kind === "throttle") {
    return {
      cause: { code: "graph_throttle" },
      text: "Meta limite les appels en ce moment — l'identifiant est bon, réessayez dans quelques minutes.",
    };
  }
  const message = err instanceof Error ? err.message : "Meta injoignable";
  return { cause: { code: "graph_error", params: { message } }, text: message };
}

export async function POST(req: NextRequest, { params }: { params: { marketId: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const allowed =
    actor.role === "super_admin" || (actor.role === "market_manager" && actor.market_id === params.marketId);
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data, error } = await admin.from("whatsapp_configs").select(CONFIG_COLUMNS).eq("market_id", params.marketId).maybeSingle();
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const row = data as ConfigRow;

  const stages: Stage[] = [];
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { last_checked_at: now, updated_at: now };
  const skipRest = (from: number) => {
    for (const key of STAGE_KEYS.slice(from)) stages.push({ key, status: "skipped", detail: "" });
  };
  /** Write the run (and whatever the stages learnt) on the row, then answer. */
  const finish = async () => {
    const ok = !stages.some((s) => s.status === "failed");
    patch.last_test_at = now;
    patch.last_test_ok = ok;
    patch.last_test_stages = stages;
    await admin.from("whatsapp_configs").update(patch).eq("id", row.id);
    Object.assign(row, patch);
    return NextResponse.json({ data: { ok, stages, config: toPublicConfig(row) } });
  };

  // 1. credentials
  const cfg = fromRow(row);
  if (cfg.decryptFailed) {
    stages.push({
      key: "credentials",
      status: "failed",
      code: "credentials_decrypt_failed",
      detail: "Identifiants illisibles — ENCRYPTION_KEY a probablement changé. Saisissez-les à nouveau.",
    });
    skipRest(1);
    return finish();
  }
  stages.push({ key: "credentials", status: "ok", code: "credentials_ok", detail: "déchiffrés, jeton système permanent" });

  const client = createWhatsAppClient(cfg);

  // 2. phone
  try {
    const phone = await client.getPhoneStatus();
    patch.display_phone = phone.displayPhone;
    patch.verified_name = phone.verifiedName;
    patch.quality_rating = phone.qualityRating;
    patch.messaging_limit_tier = phone.messagingLimitTier;
    const registered = (phone.status ?? "").toUpperCase() === "CONNECTED";
    const name = phone.verifiedName ?? "—";
    const number = phone.displayPhone ?? "—";
    stages.push(
      registered
        ? { key: "phone", status: "ok", code: "phone_registered", params: { name, phone: number }, detail: `${name} · ${number} · enregistré` }
        : {
            key: "phone",
            status: "warning",
            code: "phone_unregistered",
            params: { name, phone: number, status: phone.status ?? "?" },
            detail: `${name} · ${number} · statut ${phone.status ?? "inconnu"} — le numéro n'est pas enregistré sur la Cloud API (définissez le PIN de vérification en deux étapes dans WhatsApp Manager).`,
          },
    );
    if (row.status === "auth_failed") {
      patch.status = "active";
      patch.status_reason = null;
    }
  } catch (err) {
    const { cause, text } = graphCause(err);
    stages.push({ key: "phone", status: "failed", code: cause.code, params: cause.params, detail: text });
    if (classifyGraphError(err).kind === "auth") {
      patch.status = "auth_failed";
      patch.status_reason = `Jeton refusé (code ${err instanceof WhatsAppApiError ? err.code : 190})`;
    }
    patch.last_error = err instanceof Error ? err.message : "Meta injoignable";
    skipRest(2);
    return finish();
  }

  // 3. waba
  try {
    const templates = await client.listTemplates();
    const approved = templates.filter((t) => t.status === "APPROVED").length;
    const pending = templates.filter((t) => t.status === "PENDING").length;
    const rejected = templates.filter((t) => t.status === "REJECTED").length;
    stages.push({
      key: "waba",
      status: "ok",
      code: "waba_counts",
      params: { total: templates.length, approved, pending, rejected },
      detail: `${templates.length} modèles · ${approved} approuvé${approved > 1 ? "s" : ""}${pending ? `, ${pending} en attente` : ""}${rejected ? `, ${rejected} refusé${rejected > 1 ? "s" : ""}` : ""}`,
    });
  } catch (err) {
    const { cause, text } = graphCause(err);
    stages.push({
      key: "waba",
      status: "failed",
      code: "waba_unreadable",
      params: { waba: row.waba_id, cause },
      detail: `WABA ${row.waba_id} illisible avec ce jeton — ${text}`,
    });
  }

  // 4. subscription — the one stage we can fix ourselves.
  try {
    const apps = await client.getSubscribedApps();
    if (apps.includes(row.app_id)) {
      stages.push({ key: "subscription", status: "ok", code: "subscription_ok", detail: "l'app reçoit les événements de ce WABA" });
    } else {
      await client.subscribeApp();
      stages.push({ key: "subscription", status: "warning", code: "subscription_fixed", detail: "abonnement absent — corrigé automatiquement" });
    }
  } catch (err) {
    const { cause, text } = graphCause(err);
    stages.push({ key: "subscription", status: "failed", code: cause.code, params: cause.params, detail: text });
  }

  // 5. webhook — only Meta can prove this one, by calling us.
  const last = row.last_webhook_at ? new Date(row.last_webhook_at).getTime() : null;
  if (last && Date.now() - last < WEBHOOK_FRESH_MS) {
    const minutes = Math.round((Date.now() - last) / 60_000);
    stages.push(
      minutes < 60
        ? { key: "webhook", status: "ok", code: "webhook_min", params: { n: minutes }, detail: `dernier événement il y a ${minutes} min` }
        : { key: "webhook", status: "ok", code: "webhook_h", params: { n: Math.round(minutes / 60) }, detail: `dernier événement il y a ${Math.round(minutes / 60)} h` },
    );
  } else if (last) {
    const days = Math.round((Date.now() - last) / 86_400_000);
    stages.push({
      key: "webhook",
      status: "warning",
      code: "webhook_stale",
      params: { n: days },
      detail: `dernier événement il y a ${days} j — vérifiez l'URL de rappel et l'abonnement aux champs dans l'app Meta`,
    });
  } else {
    stages.push({
      key: "webhook",
      status: "warning",
      code: "webhook_never",
      detail: "aucun événement reçu — envoyez un message test au numéro depuis un téléphone, puis relancez le test",
    });
  }

  patch.last_error = null;
  return finish();
}

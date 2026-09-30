"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Check, Copy, Link2, Loader2, Minus, Pause, Pencil, Play, Plug, RefreshCw } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { WhatsAppGlyph } from "@/components/whatsapp/WhatsAppGlyph";
import { marketIdToCode, marketTimezone } from "@/lib/markets";

/**
 * WhatsApp Business — Cloud API, one card per market.
 *
 * Prototype: prototypes/whatsapp-manager-v1.html?screen=connexions. The card
 * shows what an operator wiring Meta up needs to see while it is only half
 * done: connected but unverified (250 recipients a day), templates pending,
 * no webhook received yet. The credential form appears in place, and nothing
 * is stored until Meta has answered a test call with those values.
 *
 * Secrets never come back from the config API: the row shows a mask. The one
 * exception is the verify token, which the operator must paste into the Meta
 * app: « Afficher » reads it from a super_admin-only route, one market at a
 * time. A market_manager sees the same card read-only — no form, no actions,
 * no reveal.
 */

type StageStatus = "ok" | "warning" | "failed" | "skipped";
type StageParams = Record<string, string | number | { code: string; params?: Record<string, string | number> }>;

export interface Stage {
  key: string;
  status: StageStatus;
  detail: string;
  /** Translatable form of `detail` (whatsappAdmin.connections.detail.*). */
  code?: string;
  params?: StageParams;
}

export interface WhatsAppConfigPublic {
  id: string;
  market_id: string;
  waba_id: string;
  phone_number_id: string;
  app_id: string;
  graph_version: string;
  display_phone: string | null;
  verified_name: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  status: "active" | "paused" | "auth_failed";
  status_reason: string | null;
  send_rate_per_sec: number;
  last_webhook_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  token_masked: string;
  has_app_secret: boolean;
  has_verify_token: boolean;
  last_test_at?: string | null;
  last_test_ok?: boolean | null;
  last_test_stages?: Stage[] | null;
  templates?: { approved: number; pending: number; rejected: number };
  automation?: {
    enabled: boolean;
    queued: number;
    sending: number;
    last_run: { started_at: string; finished_at: string | null; status: string; sent: number; failed: number } | null;
    cron: { schedule: string; active: boolean } | null;
  };
}

interface Market {
  id: string;
  name: string;
  code: string;
}

type T = ReturnType<typeof useTranslations>;

const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

const FIELDS_TO_SUBSCRIBE = ["messages", "message_template_status_update", "phone_number_quality_update", "account_update"];
const MASK = "••••••••";

const QUALITY_DOT: Record<string, string> = {
  GREEN: "bg-status-success",
  YELLOW: "bg-status-warning",
  RED: "bg-status-critical",
};

const STAGE_FILL: Record<StageStatus, string> = {
  ok: "bg-status-success",
  warning: "bg-status-warning",
  failed: "bg-status-critical",
  skipped: "bg-line-strong",
};

const STAGE_KEYS = new Set(["credentials", "phone", "waba", "subscription", "webhook"]);

/** Codes the route emits and the catalogue can say; anything else falls back to `detail`. */
const SIMPLE_CODES = new Set([
  "credentials_ok",
  "credentials_decrypt_failed",
  "phone_registered",
  "phone_unregistered",
  "graph_auth",
  "graph_throttle",
  "graph_error",
  "subscription_ok",
  "subscription_fixed",
  "webhook_min",
  "webhook_h",
  "webhook_stale",
  "webhook_never",
]);

/** Meta's tier names → the number an operator understands. */
function tierRecipients(tier: string | null): number | null {
  if (!tier) return null;
  const m = /^TIER_(\d+)(K?)$/.exec(tier);
  if (!m) return tier === "TIER_UNLIMITED" ? Infinity : null;
  return Number(m[1]) * (m[2] ? 1000 : 1);
}

function formatCount(n: number): string {
  return n.toLocaleString("fr-FR").replace(/ | /g, " ");
}

/** HH:mm in the market's own zone, Latin digits in both languages (like the prototype). */
function clockTime(iso: string, marketId: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: marketTimezone(marketId) }).format(new Date(iso));
}

function useRelative() {
  const t = useTranslations("whatsappAdmin.common");
  return useCallback(
    (iso: string | null | undefined): string => {
      if (!iso) return t("never");
      const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
      if (m < 1) return t("ago.now");
      if (m < 60) return t("ago.m", { n: m });
      const h = Math.round(m / 60);
      if (h < 48) return t("ago.h", { n: h });
      return t("ago.d", { n: Math.round(h / 24) });
    },
    [t],
  );
}

function causeText(t: T, cause: unknown): string {
  if (!cause || typeof cause !== "object") return "";
  const c = cause as { code?: string; params?: Record<string, string | number> };
  return c.code && SIMPLE_CODES.has(c.code) ? t(`detail.${c.code}`, c.params ?? {}) : "";
}

/** The stage line in the reader's language; the route's French `detail` is the fallback. */
function stageDetail(t: T, s: Stage): string {
  const p = (s.params ?? {}) as Record<string, string | number>;
  if (s.code === "waba_counts") {
    const parts = [t("detail.waba_counts", { total: p.total ?? 0, approved: p.approved ?? 0 })];
    if (Number(p.pending)) parts.push(t("detail.waba_pending", { n: p.pending }));
    if (Number(p.rejected)) parts.push(t("detail.waba_rejected", { n: p.rejected }));
    return parts.join(", ");
  }
  if (s.code === "waba_unreadable") {
    return t("detail.waba_unreadable", { waba: String(p.waba ?? ""), cause: causeText(t, (s.params ?? {}).cause) || s.detail });
  }
  if (s.code && SIMPLE_CODES.has(s.code)) return t(`detail.${s.code}`, p);
  return s.detail;
}

function generateVerifyToken(code: string): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `ordra-${code}-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function statusBadge(cfg: WhatsAppConfigPublic | undefined): { tone: BadgeTone; key: string } {
  if (!cfg) return { tone: "neutral", key: "notConnected" };
  if (cfg.status === "auth_failed") return { tone: "critical", key: "authFailed" };
  if (cfg.status === "paused") return { tone: "warning", key: "paused" };
  const recipients = tierRecipients(cfg.messaging_limit_tier);
  if (recipients !== null && recipients <= 250) return { tone: "warning", key: "unverified" };
  return { tone: "success", key: "connected" };
}

function StageIcon({ status, label }: { status: StageStatus; label: string }) {
  return (
    <span
      data-testid="wa-stage-icon"
      data-status={status}
      role="img"
      aria-label={label}
      className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold leading-none text-white ${STAGE_FILL[status]}`}
    >
      {status === "ok" ? <Check size={12} strokeWidth={3} aria-hidden /> : status === "skipped" ? <Minus size={12} strokeWidth={3} aria-hidden /> : "!"}
    </span>
  );
}

const inputCls =
  "w-full rounded-[6px] border border-line bg-surface-card px-2.5 py-2 text-[13px] text-ink-primary font-mono focus:outline-none focus:ring-2 focus:ring-brand";
const labelCls = "block text-[12px] font-medium text-ink-secondary mb-1";
const btnCls =
  "inline-flex items-center gap-1.5 rounded-[6px] border border-line-strong bg-surface-card px-3 py-2 text-[13.5px] font-medium text-ink-primary hover:bg-surface-hover transition-colors duration-fast disabled:opacity-50";
const btnPrimaryCls =
  "inline-flex items-center gap-1.5 rounded-[6px] border border-brand bg-brand px-3 py-2 text-[13.5px] font-medium text-white hover:bg-brand-hover transition-colors duration-fast disabled:opacity-50";
const btnQuietCls = "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-2 text-[13.5px] font-medium text-ink-secondary hover:bg-surface-hover";
const revealCls = "text-[12.5px] font-semibold text-status-action hover:underline disabled:opacity-50";
const chipCls = "rounded-pill bg-status-neutralBg px-2 py-0.5 text-[12px]";

interface FormState {
  waba_id: string;
  phone_number_id: string;
  app_id: string;
  access_token: string;
  app_secret: string;
  verify_token: string;
  graph_version: string;
}

function emptyForm(code: string, cfg?: WhatsAppConfigPublic): FormState {
  return {
    waba_id: cfg?.waba_id ?? "",
    phone_number_id: cfg?.phone_number_id ?? "",
    app_id: cfg?.app_id ?? "",
    access_token: "",
    app_secret: "",
    verify_token: cfg ? "" : generateVerifyToken(code),
    graph_version: cfg?.graph_version ?? "v26.0",
  };
}

/** The decrypted verify token per market, fetched on « Afficher » only. */
interface Reveal {
  value: (marketId: string) => string | null | undefined;
  failed: (marketId: string) => boolean;
  busy: (marketId: string) => boolean;
  toggle: (marketId: string) => void;
}

function useVerifyTokenReveal(): Reveal {
  const [shown, setShown] = useState<Record<string, string | null>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const toggle = useCallback(
    async (marketId: string) => {
      if (shown[marketId]) {
        setShown((s) => ({ ...s, [marketId]: null }));
        return;
      }
      setBusy((b) => ({ ...b, [marketId]: true }));
      setFailed((f) => ({ ...f, [marketId]: false }));
      try {
        const res = await fetch(`/api/whatsapp/config/${marketId}/verify-token`, { credentials: "same-origin", cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        const token: string | undefined = body?.data?.verify_token;
        if (!res.ok || !token) setFailed((f) => ({ ...f, [marketId]: true }));
        else setShown((s) => ({ ...s, [marketId]: token }));
      } catch {
        setFailed((f) => ({ ...f, [marketId]: true }));
      } finally {
        setBusy((b) => ({ ...b, [marketId]: false }));
      }
    },
    [shown],
  );
  return {
    value: (id) => shown[id],
    failed: (id) => Boolean(failed[id]),
    busy: (id) => Boolean(busy[id]),
    toggle: (id) => void toggle(id),
  };
}

function VerifyTokenValue({ marketId, has, reveal, canReveal, t }: { marketId: string; has: boolean; reveal: Reveal; canReveal: boolean; t: T }) {
  if (!has) return <span className="font-mono">—</span>;
  const value = reveal.value(marketId);
  return (
    <>
      <span className="truncate font-mono" dir="ltr">
        {value || MASK}
      </span>
      {reveal.failed(marketId) && <span className="text-[12px] text-status-critical">{t("revealFailed")}</span>}
      {canReveal && (
        <button type="button" className={revealCls} onClick={() => reveal.toggle(marketId)} disabled={reveal.busy(marketId)}>
          {value ? t("hide") : t("show")}
        </button>
      )}
    </>
  );
}

function MarketCard({
  market,
  label,
  cfg,
  readOnly,
  reveal,
  onChanged,
}: {
  market: Market;
  label: string;
  cfg: WhatsAppConfigPublic | undefined;
  readOnly: boolean;
  reveal: Reveal;
  onChanged: () => void;
}) {
  const t = useTranslations("whatsappAdmin.connections");
  const relative = useRelative();
  const toast = useToast();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "fr";
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(market.code, cfg));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [ranStages, setRanStages] = useState<Stage[] | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const badge = statusBadge(cfg);
  const recipients = tierRecipients(cfg?.messaging_limit_tier ?? null);
  const verified = recipients !== null && recipients > 250;
  const tpl = cfg?.templates ?? { approved: 0, pending: 0, rejected: 0 };
  const stages = ranStages ?? cfg?.last_test_stages ?? null;
  const stagesAt = ranStages ? ranAt : (cfg?.last_test_at ?? null);

  const openForm = () => {
    if (editing) return;
    setForm(emptyForm(market.code, cfg));
    setSaveError(null);
    setEditing(true);
  };

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const canSave = cfg
    ? // Editing: identity fields never blank; blank secrets mean "keep".
      form.waba_id.trim() !== "" && form.phone_number_id.trim() !== "" && form.app_id.trim() !== ""
    : ["waba_id", "phone_number_id", "app_id", "access_token", "app_secret"].every((k) => form[k as keyof FormState].trim() !== "");

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const isNew = !cfg;
      const payload: Record<string, unknown> = isNew
        ? { market_id: market.id, ...form }
        : Object.fromEntries(Object.entries(form).filter(([, v]) => String(v).trim() !== ""));
      const res = await fetch(isNew ? "/api/whatsapp/config" : `/api/whatsapp/config/${market.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The typed values stay: a rejected token is usually a typo, and
        // regenerating it in Meta invalidates the old one.
        setSaveError(body?.message ?? t("saveFailed"));
        return;
      }
      setEditing(false);
      setForm(emptyForm(market.code, body?.data));
      toast.show({ message: t("saved") });
      onChanged();
    } catch {
      setSaveError(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [cfg, form, market.code, market.id, onChanged, t, toast]);

  const runTest = useCallback(async () => {
    setTesting(true);
    try {
      const res = await fetch(`/api/whatsapp/config/${market.id}/test`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (body?.data?.stages) {
        setRanStages(body.data.stages);
        setRanAt(new Date().toISOString());
      }
      onChanged();
    } finally {
      setTesting(false);
    }
  }, [market.id, onChanged]);

  const setStatus = useCallback(
    async (status: "active" | "paused") => {
      setBusy(true);
      try {
        await fetch(`/api/whatsapp/config/${market.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        });
        onChanged();
      } finally {
        setBusy(false);
      }
    },
    [market.id, onChanged],
  );

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(key);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* clipboard unavailable — nothing to do */
    }
  };

  const automation = (() => {
    const a = cfg?.automation;
    if (!a?.enabled) return t("auto.off");
    if (a.cron && !a.cron.active) return t("auto.cronOff");
    return t("auto.of", { time: a.last_run ? clockTime(a.last_run.started_at, market.id) : "—", n: a.queued + a.sending });
  })();

  const tplLine = [
    t("tpl.approved", { n: tpl.approved }),
    t("tpl.pending", { n: tpl.pending }),
    ...(tpl.rejected ? [t(tpl.rejected > 1 ? "tpl.rejectedMany" : "tpl.rejectedOne", { n: tpl.rejected })] : []),
  ].join(" · ");

  const keep = (label: string) => (cfg ? t("fields.keep", { label }) : label);

  return (
    <div data-testid={`wa-card-${market.id}`} className="flex flex-col overflow-hidden rounded-[8px] border border-line bg-surface-card">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-line px-3.5 py-3">
        <span className="grid h-[34px] w-[34px] place-items-center rounded-[8px] bg-status-neutralBg text-[12px] font-bold text-ink-secondary">
          {market.code.toUpperCase()}
        </span>
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-semibold text-ink-primary">{label}</h3>
          <div className="truncate text-[12.5px] text-ink-secondary">
            {cfg ? (
              <>
                {cfg.verified_name ?? "—"} ·{" "}
                <span dir="ltr" className="tabular-nums">
                  {cfg.display_phone ?? "—"}
                </span>
              </>
            ) : (
              t("noNumber")
            )}
          </div>
        </div>
        <Badge tone={badge.tone} dot className="ms-auto">
          {t(`status.${badge.key}`)}
        </Badge>
      </div>

      {cfg ? (
        <>
          {/* health */}
          <div className="grid grid-cols-2 border-b border-line md:grid-cols-4">
            <div className="min-w-0 border-e border-line px-3 py-2.5">
              <div className="text-[11.5px] text-ink-secondary">{t("health.quality")}</div>
              <div className="mt-0.5 flex items-start gap-1.5 text-[13px] font-semibold leading-[1.3] text-ink-primary">
                <i aria-hidden className={`mt-[5px] h-2 w-2 flex-none rounded-full ${QUALITY_DOT[cfg.quality_rating ?? ""] ?? "bg-line-strong"}`} />
                {t(`quality.${QUALITY_DOT[cfg.quality_rating ?? ""] ? cfg.quality_rating : "NA"}`)}
              </div>
            </div>
            <div className="min-w-0 px-3 py-2.5 md:border-e md:border-line">
              <div className="text-[11.5px] text-ink-secondary">{t("health.tier")}</div>
              <div className="mt-0.5 text-[13px] font-semibold leading-[1.3] text-ink-primary">
                {recipients === null ? "—" : t("tierOf", { n: recipients === Infinity ? t("tierUnlimited") : formatCount(recipients) })}
              </div>
              <div className="text-[11.5px] text-ink-secondary">{verified ? t("verifOk") : t("verifPending")}</div>
            </div>
            <div className="min-w-0 border-e border-line px-3 py-2.5">
              <div className="text-[11.5px] text-ink-secondary">{t("health.templates")}</div>
              <div className="mt-0.5 text-[13px] font-semibold leading-[1.3] text-ink-primary">
                <Link href={`/${locale}/messages/templates`} className="hover:text-brand hover:underline">
                  {tplLine}
                </Link>
              </div>
            </div>
            <div className="min-w-0 px-3 py-2.5">
              <div className="text-[11.5px] text-ink-secondary">{t("health.webhook")}</div>
              <div className="mt-0.5 text-[13px] font-semibold leading-[1.3] text-ink-primary">{relative(cfg.last_webhook_at)}</div>
              <div className="text-[11.5px] text-ink-secondary" data-testid="wa-automation">
                {t("health.auto", { state: automation })}
              </div>
            </div>
          </div>

          {(cfg.status_reason || cfg.last_error) && (
            <p role="status" className="border-b border-line bg-status-criticalBg px-3.5 py-2 text-[12.5px] text-status-critical">
              {cfg.status_reason ?? cfg.last_error}
            </p>
          )}

          {/* credentials, masked */}
          <dl className="grid grid-cols-[150px_1fr] items-center gap-x-3 gap-y-1.5 px-3.5 py-3 text-[13px]">
            <dt className="text-ink-secondary">{t("fields.waba")}</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono">{cfg.waba_id}</span>
              <button type="button" onClick={() => copy("waba", cfg.waba_id)} aria-label={t("copy", { field: t("fields.waba") })} className="rounded p-0.5 text-ink-secondary hover:bg-surface-hover">
                {copied === "waba" ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </dd>
            <dt className="text-ink-secondary">{t("fields.pnid")}</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono">{cfg.phone_number_id}</span>
              <button type="button" onClick={() => copy("pnid", cfg.phone_number_id)} aria-label={t("copy", { field: t("fields.pnid") })} className="rounded p-0.5 text-ink-secondary hover:bg-surface-hover">
                {copied === "pnid" ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </dd>
            <dt className="text-ink-secondary">{t("fields.app")}</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono">{cfg.app_id}</span>
              <span className={`${chipCls} font-mono`}>{cfg.graph_version}</span>
            </dd>
            <dt className="text-ink-secondary">{t("fields.token")}</dt>
            <dd className="flex items-center gap-2">
              <span className="font-mono">{cfg.token_masked}</span>
              {!readOnly && <span className={chipCls}>{t("systemUser")}</span>}
            </dd>
            <dt className="text-ink-secondary">{t("fields.secret")}</dt>
            <dd className="font-mono">{cfg.has_app_secret ? MASK : "—"}</dd>
            <dt className="text-ink-secondary">{t("fields.verify")}</dt>
            <dd className="flex min-w-0 items-center gap-2">
              <VerifyTokenValue marketId={market.id} has={cfg.has_verify_token} reveal={reveal} canReveal={!readOnly} t={t} />
            </dd>
            <dt className="text-ink-secondary">{t("fields.rate")}</dt>
            <dd className="tabular-nums">{t("rateOf", { n: cfg.send_rate_per_sec })}</dd>
          </dl>

          {stages && stages.length > 0 && (
            <div className="border-t border-line py-1.5">
              {stagesAt && <p className="m-0 px-3.5 pb-0.5 pt-1 text-[11.5px] text-ink-secondary">{t("lastTest", { when: relative(stagesAt) })}</p>}
              <ul className="m-0 list-none p-0">
                {stages.map((s) => (
                  <li key={s.key} className="grid grid-cols-[22px_1fr] items-start gap-2.5 px-3.5 py-1.5 text-[13px]">
                    <StageIcon status={s.status} label={t(`stageStatus.${s.status}`)} />
                    <div>
                      <b className="font-semibold text-ink-primary">{STAGE_KEYS.has(s.key) ? t(`stages.${s.key}`) : s.key}</b>{" "}
                      <span className={s.status === "failed" ? "text-status-critical" : "text-ink-secondary"}>
                        {s.status === "skipped" ? "" : `— ${stageDetail(t, s)}`}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="px-3.5 py-3 text-[12.5px] text-ink-secondary">{t("notConnectedBody")}</div>
      )}

      {/* form */}
      {!readOnly && editing && (
        <div className="border-t border-line p-3.5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>{t("fields.waba")}</span>
              <input className={inputCls} dir="ltr" value={form.waba_id} onChange={set("waba_id")} inputMode="numeric" autoComplete="off" />
            </label>
            <label className="block">
              <span className={labelCls}>{t("fields.pnid")}</span>
              <input className={inputCls} dir="ltr" value={form.phone_number_id} onChange={set("phone_number_id")} inputMode="numeric" autoComplete="off" />
            </label>
            <label className="block">
              <span className={labelCls}>{t("fields.app")}</span>
              <input className={inputCls} dir="ltr" value={form.app_id} onChange={set("app_id")} inputMode="numeric" autoComplete="off" />
            </label>
            <label className="block">
              <span className={labelCls}>{t("fields.gv")}</span>
              <input className={inputCls} dir="ltr" value={form.graph_version} onChange={set("graph_version")} autoComplete="off" />
            </label>
          </div>
          <label className="mt-2.5 block">
            <span className={labelCls}>{keep(t("fields.tokenForm"))}</span>
            <input className={inputCls} dir="ltr" type="password" value={form.access_token} onChange={set("access_token")} autoComplete="off" spellCheck={false} placeholder="EAAG…" />
          </label>
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>{keep(t("fields.secret"))}</span>
              <input className={inputCls} dir="ltr" type="password" value={form.app_secret} onChange={set("app_secret")} autoComplete="off" spellCheck={false} />
            </label>
            <label className="block">
              <span className={labelCls}>{keep(t("fields.verify"))}</span>
              <div className="flex gap-1.5">
                <input className={inputCls} dir="ltr" value={form.verify_token} onChange={set("verify_token")} autoComplete="off" spellCheck={false} />
                <button type="button" className={btnCls} onClick={() => setForm((f) => ({ ...f, verify_token: generateVerifyToken(market.code) }))}>
                  {t("actions.generate")}
                </button>
              </div>
            </label>
          </div>
          {saveError && (
            <p role="alert" className="mt-2 text-[12.5px] text-status-critical">
              {saveError}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={btnPrimaryCls} onClick={save} disabled={!canSave || saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={2.4} />}
              {saving ? t("actions.saving") : t("actions.save")}
            </button>
            <button type="button" className={btnQuietCls} onClick={() => setEditing(false)}>
              {t("actions.cancel")}
            </button>
            <span className="text-[12px] text-ink-secondary">{t("formHint")}</span>
          </div>
        </div>
      )}

      {/* actions */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-sunken px-3.5 py-3">
          {cfg ? (
            <>
              <button type="button" className={btnCls} onClick={runTest} disabled={testing}>
                {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} strokeWidth={1.8} />}
                {t("actions.test")}
              </button>
              <button type="button" className={btnCls} onClick={openForm} aria-pressed={editing}>
                <Pencil size={14} strokeWidth={1.8} />
                {t("actions.edit")}
              </button>
              <span className="flex-1" />
              {cfg.status === "active" ? (
                <button type="button" className={btnQuietCls} onClick={() => setStatus("paused")} disabled={busy}>
                  <Pause size={14} strokeWidth={1.8} />
                  {t("actions.pause")}
                </button>
              ) : (
                <button type="button" className={btnPrimaryCls} onClick={() => setStatus("active")} disabled={busy}>
                  <Play size={14} strokeWidth={1.8} />
                  {t("actions.resume")}
                </button>
              )}
            </>
          ) : (
            !editing && (
              <button type="button" className={btnPrimaryCls} onClick={openForm}>
                <Plug size={14} strokeWidth={2} />
                {t("actions.connect")}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function WhatsAppSection({ markets, readOnly = false }: { markets: Market[]; readOnly?: boolean }) {
  const t = useTranslations("whatsappAdmin.connections");
  const tCommon = useTranslations("whatsappAdmin.common");
  const tMarkets = useTranslations("nav.markets");
  const { data, mutate, isLoading } = useSWR<{ data: WhatsAppConfigPublic[] }>("/api/whatsapp/config", fetcher, {
    revalidateOnFocus: false,
  });
  const byMarket = useMemo(() => new Map((data?.data ?? []).map((c) => [c.market_id, c])), [data]);
  const onChanged = useCallback(() => {
    mutate();
  }, [mutate]);
  const reveal = useVerifyTokenReveal();
  const callbackUrl = typeof window !== "undefined" ? `${window.location.origin}/api/webhooks/whatsapp` : "/api/webhooks/whatsapp";
  const labelOf = (m: Market) => {
    const code = m.code || marketIdToCode(m.id);
    return code === "tn" || code === "ly" ? tMarkets(code) : m.name;
  };

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink-primary">
          <WhatsAppGlyph size={16} strokeWidth={1.9} />
          {t("title")}
        </h2>
        <p className="mt-0.5 text-[12.5px] text-ink-secondary">{t("sub")}</p>
      </div>

      {isLoading ? (
        <p className="text-[13px] text-ink-secondary">{tCommon("loading")}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          {markets.map((m) => (
            <MarketCard key={m.id} market={m} label={labelOf(m)} cfg={byMarket.get(m.id)} readOnly={readOnly} reveal={reveal} onChanged={onChanged} />
          ))}
        </div>
      )}

      {/* webhook block — what goes into the Meta app */}
      <div data-testid="wa-webhook-block" className="overflow-hidden rounded-[8px] border border-line bg-surface-card">
        <h2 className="flex flex-wrap items-center gap-2.5 border-b border-line px-3.5 py-3 text-[14px] font-semibold text-ink-primary">
          <Link2 size={15} strokeWidth={2} aria-hidden />
          {t("hook.title")}
          <span className="ms-auto text-[12.5px] font-normal text-ink-secondary">{t("hook.sub")}</span>
        </h2>
        <dl className="grid grid-cols-[170px_1fr] items-center gap-x-3 gap-y-1.5 px-3.5 py-3.5 text-[13px]">
          <dt className="text-ink-secondary">{t("hook.url")}</dt>
          <dd className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono" dir="ltr">
              {callbackUrl}
            </span>
            <button
              type="button"
              aria-label={t("copy", { field: t("hook.url") })}
              className="rounded p-0.5 text-ink-secondary hover:bg-surface-hover"
              onClick={() => navigator.clipboard?.writeText(callbackUrl).catch(() => undefined)}
            >
              <Copy size={13} />
            </button>
          </dd>
          {markets.map((m) => {
            const cfg = byMarket.get(m.id);
            return (
              <div key={m.id} className="contents">
                <dt className="text-ink-secondary">{t("hook.verify", { market: labelOf(m) })}</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <VerifyTokenValue marketId={m.id} has={Boolean(cfg?.has_verify_token)} reveal={reveal} canReveal={!readOnly} t={t} />
                </dd>
              </div>
            );
          })}
          <dt className="text-ink-secondary">{t("hook.fields")}</dt>
          <dd className="flex flex-wrap gap-1.5">
            {FIELDS_TO_SUBSCRIBE.map((f) => (
              <span key={f} className={`${chipCls} font-mono`}>
                {f}
              </span>
            ))}
          </dd>
        </dl>
        <p className="border-t border-line px-3.5 py-2.5 text-[12.5px] text-ink-secondary">{t("hook.note")}</p>
      </div>
    </div>
  );
}

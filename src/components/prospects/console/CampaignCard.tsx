"use client";

/**
 * One campaign: what it targeted, how far it got, what it earned.
 *
 * The bar is the campaign's whole story in one line. Its first segment is red
 * on purpose — that is the part of the audience nobody owns, and in production
 * it is usually most of the bar. « Delivered products » in Libya: 290 people,
 * 290 without an agent.
 *
 * A campaign sent from the business number (wa_sender = api) adds what the
 * prototype's .ccard shows: « Depuis le numéro Ordra », the template's status
 * in words, a draft/ready/live badge, and the send funnel — drawn at zero
 * before launch so the card does not change shape when it goes live.
 *
 * Design: prototypes/prospects-manager-v1.html (campCard),
 * prototypes/whatsapp-manager-v1.html?screen=campagne (.ccard).
 */
import { useTranslations } from "next-intl";
import { Megaphone, Pencil, RefreshCw, Send } from "lucide-react";
import { conversionRate, type CampaignResult, type CampaignWhatsApp } from "@/lib/prospects/console";
import { localDayDiff, localTime, parseSendWindow } from "@/lib/whatsapp/campaign-template";
import { WhatsAppGlyph } from "@/components/whatsapp/WhatsAppGlyph";
import { Money, WhatsAppIcon } from "../ui";
import { fmt, OUTLINE, Pill } from "./ui";

export interface CampaignCardProps {
  campaign: CampaignResult;
  /** The overview shows a shorter card: no footer, no buttons. */
  compact?: boolean;
  marketCode: "ly" | "tn";
  locale: string;
  onDistribute?: (campaign: CampaignResult) => void;
  onSee?: (campaign: CampaignResult) => void;
  /** Business-number campaigns: launch once Meta approved, check, or resubmit. */
  onLaunch?: (campaign: CampaignResult) => void;
  onCheckStatus?: (campaign: CampaignResult) => void;
  onResubmit?: (campaign: CampaignResult) => void;
  /** The console's clock and the market's zone, for « Lancée hier 10:00 ». */
  now?: number;
  tz?: string;
}

const TPL_TONE: Record<string, "green" | "amber" | "red" | "grey"> = { APPROVED: "green", PENDING: "amber", REJECTED: "red" };
const TPL_STATUSES = ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED", "DRAFT", "DELETED", "UNKNOWN"];

export function CampaignCard({
  campaign: c, compact = false, marketCode, locale, onDistribute, onSee, onLaunch, onCheckStatus, onResubmit,
  now = Date.now(), tz = marketCode === "ly" ? "Africa/Tripoli" : "Africa/Tunis",
}: CampaignCardProps) {
  const t = useTranslations("prospects.console");
  const wa = c.whatsapp ?? null;
  const tplStatus = wa?.template_status ?? null;
  // The prototype's badge: a draft until Meta approves, then « Prête à lancer »,
  // then « En cours ». The template's own state is the chip beside it.
  const launchLabel = wa
    ? wa.launch_status === "launched" ? t("camps.live")
      : wa.launch_status === "ready" ? t("camps.ready")
        : t("camps.draft")
    : null;
  /** « Lancée hier 10:00 · 96 prospects · 60/h · 10–20 h » — on the market's clock. */
  function launchedLine(w: CampaignWhatsApp, audience: number): string {
    const parts: string[] = [];
    if (w.launched_at) {
      const at = new Date(w.launched_at);
      const time = localTime(at, tz);
      const days = localDayDiff(at, new Date(now), tz);
      const when = days === 0 ? t("camps.when.today", { time })
        : days === 1 ? t("camps.when.yesterday", { time })
          : t("camps.when.date", {
            time,
            date: new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { day: "2-digit", month: "2-digit", timeZone: tz }).format(at),
          });
      parts.push(t("camps.launchedAt", { when }));
    }
    parts.push(t("camps.nProspects", { n: fmt(audience, locale) }));
    if (w.rate) parts.push(t("camps.perHour", { n: w.rate }));
    const win = parseSendWindow(w.window);
    if (win) parts.push(t("camps.winV", win));
    return parts.join(" · ");
  }

  const rate = conversionRate(c);
  const pool = c.pool ?? 0;
  const audience = Math.max(c.audience, 1);

  // Segments of the audience, in the order a prospect passes through them.
  const pct = (n: number) => `${Math.max(0, (n / audience) * 100)}%`;
  const untouched = Math.max(0, c.audience - pool - c.called);
  const workedNotConverted = Math.max(0, c.called - c.converted);

  return (
    <div
      role="group"
      aria-label={c.name}
      className="flex flex-col gap-2 border-b border-[#F3F4F6] px-4 py-3.5 last:border-b-0"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Megaphone size={15} aria-hidden className="shrink-0 text-[#6B7280]" />
        <span className="min-w-0 flex-1 truncate font-semibold text-[#111827] [unicode-bidi:plaintext]">
          {c.name}
        </span>
        {wa ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[12px] font-semibold text-[#111827]">
            <WhatsAppGlyph size={13} className="text-[#15803D]" />
            {t("camps.fromOrdra")}
          </span>
        ) : c.channel && c.channel !== "call" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F6EE] px-2 py-0.5 text-[12px] font-semibold text-[#16A34A]">
            <WhatsAppIcon size={13} />
            {t(`camps.chan.${c.channel}`)}
          </span>
        ) : null}
        {wa && tplStatus ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F3F4F6] py-0.5 pe-0.5 ps-2 text-[12px] font-semibold text-[#111827]" data-testid="wa-template-status">
            {t("camps.tpl")}
            <Pill tone={TPL_TONE[tplStatus] ?? "grey"}>
              {TPL_STATUSES.includes(tplStatus) ? t(`camps.ts.${tplStatus}`) : tplStatus}
            </Pill>
          </span>
        ) : null}
        {wa && launchLabel ? <Pill tone={wa.launch_status === "launched" ? "green" : "line"}>{launchLabel}</Pill> : null}
        {pool > 0 ? <Pill tone="red">{t("camps.pool", { n: fmt(pool, locale) })}</Pill> : null}
        <span className="shrink-0 text-[12.5px] font-semibold text-[#15803D]">
          {rate !== null ? t("funnel.rate", { n: rate }) : t("funnel.noCalls")}
        </span>
      </div>

      {wa && wa.launch_status === "launched" ? (
        <p className="m-0 text-[12.5px] text-[#6B7280]">{launchedLine(wa, c.audience)}</p>
      ) : null}

      {c.offer ? (
        <p className="m-0 line-clamp-1 text-[13px] text-[#374151] [unicode-bidi:plaintext]">{c.offer}</p>
      ) : null}

      {/* Unowned · untouched · worked · converted. */}
      <span role="img" aria-label={c.name} className="flex h-2.5 overflow-hidden rounded-full bg-[#F3F4F6]">
        <span style={{ width: pct(pool) }} className="block h-full bg-[#FCA5A5]" />
        <span style={{ width: pct(untouched) }} className="block h-full bg-[#C7CDD6]" />
        <span style={{ width: pct(workedNotConverted) }} className="block h-full bg-[#8C96A5]" />
        <span style={{ width: pct(c.converted) }} className="block h-full bg-[#15803D]" />
      </span>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#6B7280]">
        <span><b className="font-semibold tabular-nums text-[#111827]">{fmt(c.audience, locale)}</b> {t("camps.audience")}</span>
        <span><b className="font-semibold tabular-nums text-[#111827]">{fmt(c.called, locale)}</b> {t("camps.called")}</span>
        <span><b className="font-semibold tabular-nums text-[#111827]">{fmt(c.converted, locale)}</b> {t("camps.conv")}</span>
        <span className="ms-auto font-semibold text-[#15803D]">
          <Money amount={c.revenue} market={marketCode} locale={locale} />
        </span>
      </div>

      {wa ? <SendFunnel wa={wa} locale={locale} /> : null}

      {wa && (wa.launch_status === "rejected" || tplStatus === "REJECTED") && wa.template_rejected_reason ? (
        <p className="m-0 rounded-lg border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[12.5px] text-[#B91C1C]">{wa.template_rejected_reason}</p>
      ) : null}

      {!compact && wa && wa.launch_status !== "launched" ? (
        <div className="flex flex-wrap items-center gap-2 pt-1 text-[13px]">
          <span className="flex-1" />
          {wa.launch_status === "pending_template" && onCheckStatus ? (
            <button type="button" onClick={() => onCheckStatus(c)} className={`h-8 px-3 text-[13px] ${OUTLINE}`}>
              <RefreshCw size={13} aria-hidden /> {t("cb.checkStatus")}
            </button>
          ) : null}
          {(wa.launch_status === "rejected" || wa.launch_status === "draft") && onResubmit ? (
            <button type="button" onClick={() => onResubmit(c)} className={`h-8 px-3 text-[13px] ${OUTLINE}`}>
              <Pencil size={13} aria-hidden /> {t("cb.resubmit")}
            </button>
          ) : null}
          {onLaunch ? (
            <button type="button" disabled={wa.launch_status !== "ready" || tplStatus !== "APPROVED"} onClick={() => onLaunch(c)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#15803D] px-3 text-[13px] font-semibold text-white disabled:opacity-40">
              <Send size={13} aria-hidden /> {t("cb.launch")}
            </button>
          ) : null}
        </div>
      ) : null}

      {!compact && (onDistribute || onSee) ? (
        <div className="flex flex-wrap items-center gap-2 pt-1 text-[13px] text-[#6B7280]">
          {pool > 0 && onDistribute ? (
            <button type="button" onClick={() => onDistribute(c)} className={`ms-auto h-8 px-3 text-[13px] ${OUTLINE}`}>
              {t("camps.distRest")}
            </button>
          ) : onSee ? (
            <button type="button" onClick={() => onSee(c)} className={`ms-auto h-8 px-3 text-[13px] ${OUTLINE}`}>
              {t("camps.see")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * En file → Envoyés → Remis → Lus → Réponses → Échecs. A message Meta refused
 * under its per-user marketing cap never reached the customer, so it counts
 * as a failure here — with the reason beside it, because unlike a bad number
 * it is not the list's fault and it will pass on another day.
 */
function SendFunnel({ wa, locale }: { wa: CampaignWhatsApp; locale: string }) {
  const t = useTranslations("prospects.console");
  const capped = wa.skipped_marketing_cap ?? 0;
  const cells = [
    ["queued", wa.queued], ["sentApi", wa.sent], ["delivered", wa.delivered],
    ["read", wa.read], ["repliedApi", wa.replied], ["failed", wa.failed + capped],
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-[#E5E7EB] bg-[#E5E7EB] sm:grid-cols-6" data-testid="wa-funnel">
      {cells.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col bg-white px-2.5 py-2">
          <span className="text-[11px] text-[#6B7280]">{t(`camps.${k}`)}</span>
          <span className="text-[16px] font-semibold tabular-nums text-[#111827]">
            <span>{fmt(v, locale)}</span>
            {k === "failed" && capped > 0 ? (
              <small className="ms-1 text-[11px] font-normal text-[#6B7280]">{t("camps.cap", { n: fmt(capped, locale) })}</small>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

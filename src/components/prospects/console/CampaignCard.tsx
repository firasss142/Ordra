"use client";

/**
 * One campaign: what it targeted, how far it got, what it earned.
 *
 * The bar is the campaign's whole story in one line. Its first segment is red
 * on purpose — that is the part of the audience nobody owns, and in production
 * it is usually most of the bar. « Delivered products » in Libya: 290 people,
 * 290 without an agent.
 *
 * Design: prototypes/prospects-manager-v1.html (campCard).
 */
import { useTranslations } from "next-intl";
import { Megaphone } from "lucide-react";
import { conversionRate, type CampaignResult } from "@/lib/prospects/console";
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
}

export function CampaignCard({
  campaign: c, compact = false, marketCode, locale, onDistribute, onSee,
}: CampaignCardProps) {
  const t = useTranslations("prospects.console");
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
        {c.channel && c.channel !== "call" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F6EE] px-2 py-0.5 text-[12px] font-semibold text-[#16A34A]">
            <WhatsAppIcon size={13} />
            {t(`camps.chan.${c.channel}`)}
          </span>
        ) : null}
        {pool > 0 ? <Pill tone="red">{t("camps.pool", { n: fmt(pool, locale) })}</Pill> : null}
        <span className="shrink-0 text-[12.5px] font-semibold text-[#15803D]">
          {rate !== null ? t("funnel.rate", { n: rate }) : t("funnel.noCalls")}
        </span>
      </div>

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

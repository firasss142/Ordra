"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowLeftRight } from "lucide-react";
import { fmtDate, syncAge } from "@/lib/carriers/scorecard/format";
import { SCORECARD_PERIODS, type ScorecardPeriodDays } from "@/lib/carriers/scorecard/types";
import { btn } from "./ui";

export function PeriodSegment({ period, onChange }: { period: ScorecardPeriodDays; onChange: (p: ScorecardPeriodDays) => void }) {
  const t = useTranslations("carrierScorecard");
  return (
    <div role="group" aria-label={t("periodAria")} className="inline-flex items-center gap-[2px] rounded-[10px] bg-tr-seg p-[3px]">
      {SCORECARD_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={period === p}
          onClick={() => onChange(p)}
          className={`h-[28px] min-w-[48px] rounded-[8px] px-[12px] text-[13px] ${
            period === p
              ? "bg-white font-semibold text-tr-ink-1 shadow-[0_1px_2px_rgba(16,24,40,.08)]"
              : "font-medium text-tr-ink-2 hover:text-tr-ink-1"
          }`}
        >
          {t(`periods.${p}`)}
        </button>
      ))}
    </div>
  );
}

export function BackLink({ href }: { href: string }) {
  const t = useTranslations("carrierScorecard");
  return (
    <Link href={href} className="inline-flex h-[32px] items-center gap-[6px] rounded-[9px] pe-[10px] ps-[6px] text-[13.5px] font-semibold text-tr-ink-2 hover:bg-white hover:text-tr-ink-1">
      <ArrowLeft size={16} aria-hidden className="rtl:-scale-x-100" />
      {t("back")}
    </Link>
  );
}

/** « Libye · 3 sept. – 3 oct. · ● Synchro il y a 8 min » */
export function ScorecardSub({
  marketCode, locale, generatedAt, days, lastSyncAt, now, withSync,
}: { marketCode: string; locale: string; generatedAt: string; days: number; lastSyncAt: string | null; now: Date; withSync: boolean }) {
  const t = useTranslations("carrierScorecard");
  const to = new Date(generatedAt);
  const from = new Date(to.getTime() - days * 86_400_000);
  const age = lastSyncAt ? syncAge(lastSyncAt, now) : null;
  return (
    <div className="mt-[3px] flex flex-wrap items-center gap-[8px] text-[13px] text-tr-ink-2">
      <span>
        {marketCode === "ly" || marketCode === "tn" ? t(`markets.${marketCode}`) : marketCode} · {fmtDate(locale, from.toISOString())} – {fmtDate(locale, to.toISOString())}
      </span>
      {withSync && age ? (
        <span className="inline-flex items-center gap-[6px] text-tr-ink-3">
          <i aria-hidden className="h-[7px] w-[7px] rounded-full bg-[#16A34A] shadow-[0_0_0_3px_rgba(22,163,74,.16)]" />
          {t("sync", { age: t(`ago.${age.unit}`, { n: age.n }) })}
        </span>
      ) : null}
    </div>
  );
}

export function CompareLink({ href }: { href: string }) {
  const t = useTranslations("carrierScorecard");
  return (
    <Link href={href} className={btn}>
      <ArrowLeftRight size={15} aria-hidden />
      {t("compare")}
    </Link>
  );
}

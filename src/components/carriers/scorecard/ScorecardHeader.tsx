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
    <div role="group" aria-label={t("periodAria")} className="tsc-seg">
      {SCORECARD_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={period === p}
          onClick={() => onChange(p)}
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
    <Link href={href} className="tsc-btn tsc-btn--back">
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
    <div className="mt-[8px] flex flex-wrap items-center gap-[10px] text-[13.5px] font-medium text-tr-ink-3">
      <span>
        {marketCode === "ly" || marketCode === "tn" ? t(`markets.${marketCode}`) : marketCode} · {fmtDate(locale, from.toISOString())} – {fmtDate(locale, to.toISOString())}
      </span>
      {withSync && age ? (
        <span className="inline-flex items-center gap-[6px] text-tr-ink-3">
          <i aria-hidden className="tsc-live" />
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

/** « Performance › Livraison » — where the page sits in the sidebar. */
export function ScorecardCrumb() {
  const t = useTranslations("carrierScorecard");
  const nav = useTranslations("nav");
  return (
    <nav aria-label={t("crumbLabel")} className="tsc-crumb">
      {nav("sections.performance")} <i aria-hidden>›</i> {nav("items.perfDelivery")}
    </nav>
  );
}

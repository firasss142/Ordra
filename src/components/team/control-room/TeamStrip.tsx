"use client";

import { useTranslations } from "next-intl";
import { Clock, Coins, Gauge, ListChecks, Percent, Target } from "lucide-react";
import type { ReactNode } from "react";
import type { PerformanceView } from "@/lib/team/view-models";
import { formatActiveMinutes } from "@/lib/team/goals";
import { fmtNum, fmtPct } from "@/lib/team/format";
import { fmtCommission } from "@/lib/commissions/view-models";

function Cell({ icon, label, value, caption, children }: { icon: ReactNode; label: string; value: ReactNode; caption?: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[42px_1fr] items-start gap-x-3 border-e border-line-subtle px-[14px] py-4 last:border-e-0 max-md:border-e-0 max-md:border-b">
      <div className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-[#F0F1F2] text-ink-primary">{icon}</div>
      <div>
        <div className="text-[14px] text-ink-primary">{label}</div>
        <div className="mt-px whitespace-nowrap text-[24px] font-bold leading-[1.15] tabular-nums text-ink-primary">{value}</div>
        {caption && <div className="mt-[3px] text-[12px] text-ink-secondary">{caption}</div>}
        {children}
      </div>
    </div>
  );
}

export interface StripCommissions {
  earned: number;
  delivered: number;
  paid: number;
  marketCode: string;
}

export function TeamStrip({ view, locale, commissions }: { view: PerformanceView; locale: string; commissions?: StripCommissions | null }) {
  const t = useTranslations("team.perf.strip");
  const tc = useTranslations("team.commissions");
  const tm = view.team;
  const small = (s: string) => <span className="text-[14px] font-medium text-ink-secondary">{s}</span>;
  return (
    <div className={`grid grid-cols-1 rounded-card border border-line-subtle bg-surface-card md:grid-cols-2 ${commissions ? "xl:grid-cols-6" : "xl:grid-cols-5"}`}>
      <Cell icon={<ListChecks size={22} strokeWidth={1.9} />} label={t("treated")} value={fmtNum(locale, tm.treated)} caption={t("treatedCap")} />
      <Cell icon={<Percent size={22} strokeWidth={1.9} />} label={t("rate")} value={fmtPct(locale, tm.rate)} caption={t("rateCap", { c: fmtNum(locale, tm.confirmed), t: fmtNum(locale, tm.treated) })} />
      <Cell icon={<Clock size={22} strokeWidth={1.9} />} label={t("hours")} value={formatActiveMinutes(tm.activeMinutes)} caption={t("hoursCap")} />
      <Cell
        icon={<Gauge size={22} strokeWidth={1.9} />}
        label={t("throughput")}
        value={<>{tm.medianThroughput === null ? "—" : fmtNum(locale, tm.medianThroughput, 1)} {small(t("perHour"))}</>}
        caption={t("throughputCap")}
      />
      <Cell
        icon={<Target size={22} strokeWidth={1.9} />}
        label={t("teamGoal")}
        value={<>{fmtNum(locale, tm.goal.value)} {small(t("teamGoalOf", { target: fmtNum(locale, tm.goal.target) }))}</>}
      >
        <div className="mt-2 flex items-center gap-2.5">
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-pill bg-[#EAECEE]">
            <i className="absolute inset-y-0 start-0 rounded-pill bg-brand" style={{ width: `${tm.goal.pct}%` }} />
          </div>
          <span className="text-[12.5px] font-semibold tabular-nums text-brand">{fmtNum(locale, tm.goal.pct)} %</span>
        </div>
      </Cell>
      {commissions && (
        <Cell
          icon={<Coins size={22} strokeWidth={1.9} />}
          label={tc("stripLabel")}
          value={fmtCommission(commissions.earned, commissions.marketCode)}
          caption={tc("stripCap", { delivered: commissions.delivered, paid: fmtCommission(commissions.paid, commissions.marketCode) })}
        />
      )}
    </div>
  );
}

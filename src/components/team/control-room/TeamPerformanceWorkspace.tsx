"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarDays } from "lucide-react";
import type { Period } from "@/components/dashboard/FilterBar";
import { useToast } from "@/components/ui/Toast";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTeamPerformance } from "@/hooks/useTeamPerformance";
import { buildPerformanceView } from "@/lib/team/view-models";
import type { Role } from "@/types";
import { fmtDayShort } from "@/lib/team/format";
import { TeamPageHeader, TeamCard } from "./Card";
import { PeriodControls, type PeriodPreset } from "./PeriodControls";
import { TeamStrip } from "./TeamStrip";
import { RankingCard } from "./RankingCard";
import { ThroughputRateChart } from "./ThroughputRateChart";
import { ProductsCard } from "./ProductsCard";
import { PresenceHeatmap } from "./PresenceHeatmap";
import { AgentDrawer } from "./AgentDrawer";

interface Props {
  marketId: string;
  locale: string;
  tz: string;
  role: Role;
}

function isoDayIn(tz: string, d: Date, offsetDays = 0): string {
  const shifted = new Date(d.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
}

export function TeamPerformanceWorkspace({ marketId, locale, tz, role }: Props) {
  const t = useTranslations("team.perf");
  const { show } = useToast();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const todayISO = isoDayIn(tz, now);
  const [period, setPeriod] = useState<Period>({ from_date: isoDayIn(tz, now, -6), to_date: todayISO });
  const [preset, setPreset] = useState<PeriodPreset>("7d");
  const [productKey, setProductKey] = useState<string>("all");
  const [selected, setSelected] = useState<string | null>(null);

  const { perf, error, mutate } = useTeamPerformance(marketId, period.from_date, period.to_date);
  const view = useMemo(() => (perf ? buildPerformanceView(perf) : null), [perf]);
  const canSetTargets = role === "super_admin" || role === "market_manager";

  async function setTarget(agentId: string, metric: "min_rate" | "throughput", value: number) {
    const res = await fetch("/api/team/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, metric, value }),
    });
    if (res.ok) {
      show({ message: t("ranking.targetSaved"), tone: "info" });
      void mutate();
    } else {
      show({ message: t("ranking.targetFailed"), tone: "critical" });
    }
  }

  const rangeLabel = `${fmtDayShort(locale, period.from_date, tz)} → ${new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(new Date(`${period.to_date}T12:00:00Z`))}`;
  const tzShort = tz.split("/")[1]?.replace("_", " ") ?? tz;

  return (
    <div className="mx-auto max-w-[1420px]">
      <TeamPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        right={
          <>
            <CalendarDays size={16} aria-hidden="true" />
            <b className="font-medium text-ink-primary">{rangeLabel}</b>
            <span>· {tzShort}</span>
          </>
        }
      />

      <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <PeriodControls period={period} preset={preset} todayISO={todayISO} onChange={(p, pr) => { setPeriod(p); setPreset(pr); }} />
          <select
            aria-label={t("productFilter")}
            value={productKey}
            onChange={(e) => setProductKey(e.target.value)}
            className="h-[38px] min-w-[200px] cursor-pointer rounded-lg border border-line bg-surface-card px-3 text-[13.5px] font-medium text-ink-primary"
          >
            <option value="all">{t("allProducts")}</option>
            {(view?.products ?? []).map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>
        <span className="text-[12.5px] text-ink-secondary">{t("maskHint")}</span>
      </div>

      {error && !perf && <TeamCard className="px-4 py-6 text-[13.5px] text-status-critical">{t("loadError")}</TeamCard>}
      {!perf && !error && (
        <div className="flex flex-col gap-3.5" role="status">
          <Skeleton className="h-[110px] w-full" />
          <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2"><Skeleton className="h-[380px] w-full" /><Skeleton className="h-[380px] w-full" /></div>
        </div>
      )}

      {view && (
        <div className="flex flex-col gap-3.5">
          <TeamStrip view={view} locale={locale} />
          <div className="grid grid-cols-1 items-stretch gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
            <RankingCard view={view} locale={locale} productKey={productKey === "all" ? null : productKey} onSelectAgent={setSelected} onSetTarget={setTarget} canSetTargets={canSetTargets} />
            <ThroughputRateChart view={view} locale={locale} />
          </div>
          <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
            <ProductsCard view={view} locale={locale} />
            <PresenceHeatmap view={view} locale={locale} tz={tz} onSelectAgent={setSelected} />
          </div>
        </div>
      )}

      <AgentDrawer
        agentId={selected}
        onClose={() => setSelected(null)}
        marketId={marketId}
        locale={locale}
        tz={tz}
        perf={perf}
        defaultPeriod={{ from: period.from_date, to: period.to_date }}
        now={now}
      />
    </div>
  );
}

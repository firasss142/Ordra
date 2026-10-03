"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTeamDay, useTeamFunnel } from "@/hooks/useTeamRoom";
import { useTeamCommissions } from "@/hooks/useTeamCommissions";
import { buildDayView } from "@/lib/team/room/day-view";
import { buildFunnelView } from "@/lib/team/room/funnel-view";
import { parsePeriod, periodRange, serializePeriod, type FunnelPeriod } from "@/lib/team/room/period";
import { addDays, localDayMinute, todayIn } from "@/lib/team/room/time";
import { buildCommissionView } from "@/lib/commissions/view-models";
import { submitPayout } from "@/lib/commissions/payouts-client";
import { canManageCommissions } from "@/lib/role-permissions";
import { marketIdToCode } from "@/lib/markets";
import type { Role } from "@/types";
import { PayoutModal, type PayoutRequest } from "@/components/team/control-room/PayoutModal";
import { RoomHeader, IntakeBanner } from "./RoomHeader";
import { TodayStrip } from "./TodayStrip";
import { AgentsTodayCard } from "./AgentsTodayCard";
import { FunnelCard, PeriodControl, type BalanceInfo } from "./FunnelCard";
import { AgentPanel, type PanelPeriod } from "./AgentPanel";
import { Band, RoomCard } from "./parts";
import { useRoomFormat } from "./useRoomFormat";

/** How far back the day stepper goes. */
const DAYS_BACK = 92;

interface Props {
  marketId: string;
  locale: string;
  tz: string;
  role: Role;
}

/**
 * /team — Salle de contrôle v5 (prototypes/team-v5.html, plans/team-control-room-v5.md).
 * Two bands: the day (who is working, what moved, what is still held) and the
 * agents over a period (assigned → uploaded → delivered, commission). Everything
 * the user picks lives in the URL, so a link from the bell opens the same view.
 */
export function ControlRoom({ marketId, locale, tz, role }: Props) {
  const t = useTranslations("team.room");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { show } = useToast();
  const market = marketIdToCode(marketId) ?? "tn";
  const fmt = useRoomFormat(locale, market.toUpperCase());

  // "Today" in the market, re-read every minute so the page rolls over at midnight.
  const [today, setToday] = useState(() => todayIn(tz));
  useEffect(() => {
    const id = setInterval(() => setToday(todayIn(tz)), 60_000);
    return () => clearInterval(id);
  }, [tz]);

  const firstDay = addDays(today, -DAYS_BACK);
  const rawDay = params.get("day");
  const day = rawDay && /^\d{4}-\d{2}-\d{2}$/.test(rawDay) && rawDay <= today && rawDay >= firstDay ? rawDay : today;
  const agentId = params.get("agent");
  const panelPeriod: PanelPeriod = params.get("dper") === "week" ? "week" : "day";
  const period = parsePeriod(params.get("periode"), today);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // ── the day ──
  const live = day === today;
  const { day: dayData, error: dayError } = useTeamDay(marketId, day, live);
  const view = useMemo(() => (dayData ? buildDayView(dayData) : null), [dayData]);

  // ── the period table ──
  const range = useMemo(() => periodRange(period, today), [period, today]);
  const { funnel } = useTeamFunnel(marketId, range);
  // Balances are all-time; the period only feeds numbers this page does not show.
  const { commissions, mutate: mutateCommissions } = useTeamCommissions(marketId, addDays(today, -6), today);
  const commissionView = useMemo(() => (commissions ? buildCommissionView(commissions) : null), [commissions]);
  const balances = useMemo(() => {
    const out: Record<string, BalanceInfo> = {};
    for (const a of commissions?.agents ?? []) out[a.agent_id] = { balance: a.balance, lastPaidAt: a.last_payout ? localDayMinute(a.last_payout.at, tz).day : null };
    return out;
  }, [commissions, tz]);
  const funnelView = useMemo(
    () => (funnel ? buildFunnelView(funnel, { balances: Object.fromEntries(Object.entries(balances).map(([k, v]) => [k, v.balance])), today }) : null),
    [funnel, balances, today],
  );

  // ── payouts ──
  const canPay = canManageCommissions(role);
  const [payId, setPayId] = useState<string | null>(null);
  const payAgent = payId ? commissionView?.byId[payId]?.agent ?? null : null;
  const onPayoutSubmit = useCallback(
    async (req: PayoutRequest) => {
      const r = await submitPayout(req);
      show({ message: r.ok ? t("payout.saved") : t("payout.failed"), tone: r.ok ? "info" : "critical" });
      if (r.ok) void mutateCommissions();
      return r;
    },
    [show, t, mutateCommissions],
  );

  const marketName = t(`market.${market}`);
  const fallbackName = agentId ? funnel?.agents.find((a) => a.agent_id === agentId)?.name ?? commissionView?.byId[agentId]?.agent.name ?? null : null;
  const periodTitle =
    period.kind === "rolling30" ? t("period.bandRolling") : period.kind === "month" ? t("period.bandMonth", { m: fmt.month(period.month) }) : t("period.bandRange", { from: fmt.dayNum(range.from), to: fmt.dayNum(range.to) });

  return (
    <div className="mx-auto flex max-w-[1320px] flex-col gap-[14px]">
      <RoomHeader
        locale={locale}
        marketName={marketName}
        day={day}
        today={today}
        live={live}
        nowMin={view?.live ? view.cut : null}
        restDay={view?.work === false}
        firstDay={firstDay}
        fmt={fmt}
        onDay={(d) => setParams({ day: d })}
        onStep={(k) => {
          const next = addDays(day, k);
          setParams({ day: next >= today ? null : next < firstDay ? firstDay : next });
        }}
      />

      {view?.intakeSilentMin != null && dayData?.last_order_at && (
        <IntakeBanner
          locale={locale}
          silentMin={view.intakeSilentMin}
          lastLabel={(() => {
            const at = localDayMinute(dayData.last_order_at, tz);
            return t("banner.when", { d: fmt.dayShort(at.day), t: fmt.hm(at.min) });
          })()}
          fmt={fmt}
        />
      )}

      <Band title={live ? t("band.today") : t("band.past")} meta={live && view ? `${fmt.dayShort(day)} · ${fmt.hm(view.cut)}` : fmt.dayShort(day)} />

      {dayError && !view && <RoomCard className="px-[18px] py-[16px] text-[13.5px] text-room-red">{t("loadError")}</RoomCard>}
      {!view && !dayError && (
        <div className="flex flex-col gap-[14px]" role="status">
          <Skeleton className="h-[104px] w-full" />
          <Skeleton className="h-[320px] w-full" />
        </div>
      )}
      {view && (
        <>
          <TodayStrip view={view} fmt={fmt} />
          <AgentsTodayCard view={view} fmt={fmt} market={market} selected={agentId} onSelect={(id) => setParams({ agent: id })} />
        </>
      )}

      <Band
        title={periodTitle}
        meta={t("band.assignedRange", { from: fmt.dayNum(range.from), to: fmt.dayNum(range.to) })}
        end={
          <>
            <PeriodControl key={serializePeriod(period)} period={period} today={today} fmt={fmt} onChange={(p: FunnelPeriod) => setParams({ periode: p.kind === "rolling30" ? null : serializePeriod(p) })} />
            {commissionView && (
              <span className="flex items-baseline gap-[8px] text-[12.5px] text-room-ink-3">
                <span>{t("band.due")}</span>
                <b className="text-[16px] font-[650] text-ink-primary tabular-nums">{fmt.money(commissionView.totals.to_pay_sum)}</b>
              </span>
            )}
          </>
        }
      />
      {funnelView ? (
        <FunnelCard
          view={funnelView}
          period={period}
          fmt={fmt}
          balances={balances}
          canPay={canPay}
          selected={agentId}
          onSelect={(id) => setParams({ agent: id })}
          onPay={setPayId}
        />
      ) : (
        <Skeleton className="h-[360px] w-full" />
      )}

      <AgentPanel
        marketId={marketId}
        market={market}
        agentId={agentId}
        fallbackName={fallbackName}
        view={view}
        period={panelPeriod}
        locale={locale}
        fmt={fmt}
        canPay={canPay}
        onPeriod={(p) => setParams({ dper: p === "week" ? "week" : null })}
        onPay={setPayId}
        onClose={() => setParams({ agent: null, dper: null })}
      />

      <PayoutModal
        open={payAgent !== null}
        agent={payAgent ? { id: payAgent.agent_id, name: payAgent.name, balance: payAgent.balance } : null}
        marketCode={market.toUpperCase()}
        currency={commissions?.currency ?? ""}
        tz={tz}
        locale={locale}
        onClose={() => setPayId(null)}
        onSubmit={onPayoutSubmit}
      />
    </div>
  );
}

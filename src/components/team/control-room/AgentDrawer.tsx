"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Clock, Inbox, Package, StickyNote, Target, XCircle } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { fetcher } from "@/lib/swr-config";
import { buildTeamLiveKey } from "@/hooks/useTeamLive";
import { buildTeamPerformanceKey } from "@/hooks/useTeamPerformance";
import type { TeamLive, TeamPerformance } from "@/lib/team/types";
import { buildLiveView, buildPerformanceView } from "@/lib/team/view-models";
import { formatActiveMinutes, MIN_TREATED_FOR_RATE, rateOf } from "@/lib/team/goals";
import { fmtAge, fmtNum, fmtPct } from "@/lib/team/format";
import { AgentAvatar } from "./AgentAvatar";
import { GoalSegments } from "./GoalSegments";

interface Props {
  agentId: string | null;
  onClose: () => void;
  marketId: string;
  locale: string;
  tz: string;
  live?: TeamLive | null;
  perf?: TeamPerformance | null;
  /** last 7 local days when the caller has no period of its own */
  defaultPeriod: { from: string; to: string };
  now: Date;
}

function SecLabel({ icon: Icon, children }: { icon: typeof Clock; children: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {children}
    </div>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div className="rounded-md bg-surface-sunken px-1 py-2 text-center">
      <div className="text-[17px] font-bold tabular-nums text-ink-primary">{v}</div>
      <div className="mt-px text-[10.5px] text-ink-secondary">{l}</div>
    </div>
  );
}

function rateTone(r: number | null, min: number): string {
  if (r === null) return "text-ink-muted";
  if (r >= min + 5) return "text-status-success";
  if (r >= min - 10) return "text-oms-age-warm";
  return "text-status-critical";
}

export function AgentDrawer({ agentId, onClose, marketId, locale, tz, live, perf, defaultPeriod, now }: Props) {
  const t = useTranslations("team.drawer");
  const tStatus = useTranslations("orders.statuses");
  const tReason = useTranslations("orders.rejectionReasons");
  const open = agentId !== null;

  const { data: liveData } = useSWR<{ data: TeamLive }>(open && !live ? buildTeamLiveKey(marketId) : null, fetcher, { revalidateOnFocus: false });
  const { data: perfData } = useSWR<{ data: TeamPerformance }>(
    open && !perf ? buildTeamPerformanceKey(marketId, defaultPeriod.from, defaultPeriod.to) : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const liveNow = live ?? liveData?.data ?? null;
  const perfNow = perf ?? perfData?.data ?? null;

  const liveView = useMemo(() => (liveNow ? buildLiveView(liveNow) : null), [liveNow]);
  const perfView = useMemo(() => (perfNow ? buildPerformanceView(perfNow) : null), [perfNow]);
  const la = liveView?.agents.find((a) => a.agent.agent_id === agentId) ?? null;
  const pa = agentId && perfView ? perfView.byId[agentId] ?? null : null;
  const name = la?.agent.name ?? pa?.agent.name ?? "";
  const minRate = pa?.targets.minRate ?? la?.targets.minRate ?? 40;

  const teamProductRate = useMemo(() => {
    const m: Record<string, number | null> = {};
    perfNow?.products.forEach((p) => { m[p.key] = rateOf(p.confirmed, p.treated); });
    return m;
  }, [perfNow]);

  return (
    <Sheet open={open} onClose={onClose} ariaLabel={name}>
      <div className="flex h-full flex-col">
        <div className="flex h-[56px] shrink-0 items-center justify-between gap-2.5 border-b border-line-subtle px-4">
          <div className="flex items-center gap-2.5">
            {(la || pa) && <AgentAvatar name={name} avatarUrl={la?.agent.avatar_url ?? pa?.agent.avatar_url} presence={la?.agent.presence ?? null} />}
            <div>
              <div className="text-[15px] font-semibold text-ink-primary">{name}</div>
              {la?.agent.presence && <div className="text-[11.5px] text-ink-secondary">{t(`presence.${la.agent.presence}`)}</div>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t("close")} className="rounded-md px-2 py-1 text-[18px] text-ink-secondary hover:bg-surface-hover hover:text-ink-primary">✕</button>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {/* Today */}
          <section className="rounded-card border border-line-subtle p-3.5">
            <SecLabel icon={Clock}>{t("today")}</SecLabel>
            {la && !la.goals.idle ? (
              <>
                <div className="grid grid-cols-4 gap-2 tabular-nums">
                  <Stat v={fmtNum(locale, la.agent.today.touches)} l={t("calls")} />
                  <Stat v={fmtNum(locale, la.agent.today.treated)} l={t("treated")} />
                  <Stat v={fmtNum(locale, la.agent.today.confirmed)} l={t("confirmed")} />
                  <Stat v={formatActiveMinutes(la.agent.today.active_minutes)} l={t("activity")} />
                </div>
                <div className="mt-3 flex items-center justify-between text-[12.5px] text-ink-secondary">
                  <span>{t("goalsToday")}</span>
                  <GoalSegments goals={la.goals} />
                </div>
              </>
            ) : (
              <p className="py-2 text-[12.5px] text-ink-muted">{t("noActionToday")}</p>
            )}
          </section>

          {/* Goals over the period */}
          <section className="rounded-card border border-line-subtle p-3.5">
            <SecLabel icon={Target}>{t("goalsPeriod")}</SecLabel>
            {pa ? (
              <>
                <div className="grid grid-cols-4 gap-2 tabular-nums">
                  <Stat v={pa.confPerHour === null ? "—" : fmtNum(locale, pa.confPerHour, 1)} l={t("confPerHour", { target: fmtNum(locale, pa.targets.confPerHour, 1) })} />
                  <Stat v={fmtNum(locale, pa.streak.current)} l={t("streak")} />
                  <Stat v={fmtNum(locale, pa.streak.best)} l={t("bestStreak")} />
                  <Stat v={`${fmtNum(locale, pa.agent.days_active)}/${perfView?.days.length ?? 7}`} l={t("daysActive")} />
                </div>
                <p className="mt-2 text-[12px] text-ink-secondary">
                  {t("rules", { volume: pa.targets.dailyTreated, rate: pa.targets.minRate, min: MIN_TREATED_FOR_RATE })}
                </p>
              </>
            ) : (
              <p className="py-2 text-[12.5px] text-ink-muted">{t("loading")}</p>
            )}
          </section>

          {/* By product */}
          <section className="rounded-card border border-line-subtle p-3.5">
            <SecLabel icon={Package}>{t("byProduct")}</SecLabel>
            {pa && pa.agent.products.length > 0 ? (
              pa.agent.products.map((p) => {
                const r = p.treated >= MIN_TREATED_FOR_RATE ? rateOf(p.confirmed, p.treated) : null;
                const team = teamProductRate[p.key] ?? null;
                const d = r !== null && team !== null ? Math.round((r - team) * 10) / 10 : null;
                return (
                  <div key={p.key} className="flex items-center gap-2.5 border-b border-line-subtle py-[7px] text-[13px] last:border-b-0">
                    <span className="min-w-0 flex-1 truncate" dir="auto" title={p.name}>{p.name}</span>
                    <span className="w-[52px] text-end font-semibold tabular-nums">{fmtNum(locale, p.treated)}</span>
                    <span className={`w-[70px] text-end text-[12px] tabular-nums ${r === null ? "text-ink-muted" : `font-semibold ${rateTone(r, minRate)}`}`}>
                      {r === null ? `${p.confirmed}/${p.treated}` : fmtPct(locale, r)}
                    </span>
                    <span className={`w-[110px] text-end text-[11.5px] font-semibold tabular-nums ${d === null ? "text-ink-muted" : d > 1 ? "text-status-success" : d < -1 ? "text-status-critical" : "text-ink-muted"}`}>
                      {d === null ? "" : t("vsTeam", { d: `${d > 0 ? "+" : "−"}${fmtNum(locale, Math.abs(d), 1)}` })}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="py-2 text-[12.5px] text-ink-muted">{t("noneTreated")}</p>
            )}
          </section>

          {/* Current queue */}
          <section className="rounded-card border border-line-subtle p-3.5">
            <SecLabel icon={Inbox}>{t("queue")}</SecLabel>
            {la && la.agent.queue.by_product.length > 0 ? (
              la.agent.queue.by_product.map((q, i) => (
                <div key={i} className="flex items-center gap-2.5 border-b border-line-subtle py-[7px] text-[13px] last:border-b-0">
                  <span className="min-w-0 flex-1 truncate" dir="auto">{q.product_name ?? "—"}</span>
                  <span className="text-[12px] text-ink-secondary">{fmtNum(locale, q.n)} · {tStatus.has(q.status) ? tStatus(q.status) : q.status}</span>
                  {q.oldest_days != null && (
                    <span className={`ms-2 font-semibold tabular-nums ${q.oldest_days > 1 && q.status !== "dispatch_scheduled" ? "text-oms-age-late" : "text-ink-secondary"}`}>{fmtAge(locale, q.oldest_days)}</span>
                  )}
                </div>
              ))
            ) : (
              <p className="py-2 text-[12.5px] text-ink-muted">{t("queueEmpty")}</p>
            )}
          </section>

          {/* Rejections */}
          <section className="rounded-card border border-line-subtle p-3.5">
            <SecLabel icon={XCircle}>{t("rejections")}</SecLabel>
            {pa && pa.agent.motifs.length > 0 ? (
              (() => {
                const total = pa.agent.motifs.reduce((s, m) => s + m.n, 0);
                return pa.agent.motifs.map((m) => {
                  const label = tReason.has(m.reason) ? tReason(m.reason) : m.reason === "unknown" ? t("unknownReason") : m.reason;
                  const vague = m.reason === "autre" && m.n / total > 0.5;
                  return (
                    <div key={m.reason} className="flex items-center gap-2.5 border-b border-line-subtle py-[7px] text-[13px] last:border-b-0">
                      <span className="min-w-0 flex-1 truncate">
                        {label}
                        {vague && <span className="ms-2 text-[11.5px] font-medium text-oms-age-warm">{t("vagueReason")}</span>}
                      </span>
                      <span className="w-[52px] text-end font-semibold tabular-nums">{fmtNum(locale, m.n)}</span>
                      <span className="w-[80px] text-end"><i className="inline-block h-[5px] rounded-[3px] bg-chart-line align-middle" style={{ width: Math.round((m.n / total) * 70) + 4 }} /></span>
                    </div>
                  );
                });
              })()
            ) : (
              <p className="py-2 text-[12.5px] text-ink-muted">{t("noRejections")}</p>
            )}
          </section>

          {/* Note */}
          {pa && (
            <section className="rounded-card border border-line-subtle bg-surface-sunken p-3.5">
              <SecLabel icon={StickyNote}>{t("takeaway")}</SecLabel>
              <p className="text-[13px] leading-[1.5] text-ink-primary">
                {pa.coaching?.metric === "rate"
                  ? t("takeawayRate", { rate: fmtPct(locale, pa.rate), target: pa.coaching.value })
                  : pa.coaching?.metric === "throughput"
                    ? t("takeawayThroughput", { thr: pa.throughput === null ? "—" : fmtNum(locale, pa.throughput, 1), target: pa.coaching.value })
                    : t("takeawayNone")}
                {la && la.agent.presence === "offline" && la.agent.queue.total > 0 && la.agent.last_action &&
                  (now.getTime() - new Date(la.agent.last_action.at).getTime()) / 86_400_000 >= 3 &&
                  ` ${t("takeawayOrphan", { n: la.agent.queue.total })}`}
              </p>
            </section>
          )}
        </div>
      </div>
    </Sheet>
  );
}

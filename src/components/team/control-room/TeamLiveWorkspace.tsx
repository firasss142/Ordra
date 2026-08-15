"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { fetcher } from "@/lib/swr-config";
import { useTeamLive } from "@/hooks/useTeamLive";
import { buildLiveView } from "@/lib/team/view-models";
import type { BlockedOrder } from "@/lib/team/types";
import { reassignOrders } from "@/lib/team/reassign-queue";
import { Skeleton } from "@/components/ui/Skeleton";
import { TeamPageHeader, TeamCard } from "./Card";
import { LiveTiles } from "./LiveTiles";
import { AgentRoster, useRelativeLabel } from "./AgentRoster";
import { BlockedOrdersCard } from "./BlockedOrdersCard";
import { UpcomingCallbacksCard } from "./UpcomingCallbacksCard";
import { AgentDrawer } from "./AgentDrawer";

interface Props {
  marketId: string;
  locale: string;
  tz: string;
}

function isoDayIn(tz: string, d: Date, offsetDays = 0): string {
  const shifted = new Date(d.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(shifted);
}

export function TeamLiveWorkspace({ marketId, locale, tz }: Props) {
  const t = useTranslations("team.live");
  const { show } = useToast();
  const { live, isLoading, error, mutate } = useTeamLive(marketId);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  const [selected, setSelected] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState<BlockedOrder | null>(null);

  const { data: agentsData } = useSWR<{ data: { id: string; full_name: string }[] }>(
    `/api/agents?market_id=${encodeURIComponent(marketId)}`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 300_000 },
  );
  const agentsForReassign = useMemo(() => (agentsData?.data ?? []).map((a) => ({ id: a.id, full_name: a.full_name })), [agentsData]);

  const view = useMemo(() => (live ? buildLiveView(live) : null), [live]);
  const rel = useRelativeLabel(locale, tz, now);

  const lastSeenCaption = useMemo(() => {
    if (!live) return null;
    const seen = live.agents.filter((a) => a.last_seen_at).sort((a, b) => (a.last_seen_at! < b.last_seen_at! ? 1 : -1));
    if (seen.length === 0) return t("tiles.nobodySeen");
    return t("tiles.lastSeen", { name: seen[0].name, rel: rel(seen[0].last_seen_at!) });
  }, [live, rel, t]);

  const onToast = useCallback((message: string, tone: "success" | "error") => show({ message, tone: tone === "error" ? "critical" : "info" }), [show]);

  async function reassignBlocked(target: string | null) {
    if (!reassignTarget) return;
    const o = reassignTarget;
    setReassignTarget(null);
    const r = await reassignOrders([o.order_id], target);
    onToast(r.failed ? t("roster.reassignFailed") : t("roster.reassignDone", { n: 1 }), r.failed ? "error" : "success");
    void mutate();
  }

  const stamp = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(live ? new Date(live.computed_at) : now);
  const tzShort = tz.split("/")[1]?.replace("_", " ") ?? tz;
  const defaultPeriod = { from: isoDayIn(tz, now, -6), to: isoDayIn(tz, now) };

  return (
    <div className="mx-auto max-w-[1420px]">
      <TeamPageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        right={
          <>
            <span className="relative inline-block h-2 w-2 rounded-full bg-status-success" aria-hidden="true" />
            <b className="font-medium text-ink-primary">{t("realtime")}</b>
            <span>· {stamp} ({tzShort})</span>
          </>
        }
      />

      {error && !live && (
        <TeamCard className="px-4 py-6 text-[13.5px] text-status-critical">{t("loadError")}</TeamCard>
      )}

      {!live && !error && (
        <div className="flex flex-col gap-3.5" role="status">
          <Skeleton className="h-11 w-full" />
          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[118px] w-full" />)}
          </div>
          <Skeleton className="h-[320px] w-full" />
        </div>
      )}

      {live && view && (
        <div className="flex flex-col gap-3.5">
          <TeamCard className="flex flex-wrap gap-2.5 px-4 py-3 text-[14.5px] font-medium text-ink-primary tabular-nums">
            <span>{t("verdict.online", { count: view.verdict.online })}</span>
            <span className="text-ink-muted">·</span>
            <span>{t("verdict.blocked", { count: view.verdict.blocked })}</span>
            <span className="text-ink-muted">·</span>
            <span>{t("verdict.orphan", { count: view.verdict.orphanAgents })}</span>
          </TeamCard>

          <LiveTiles live={live} locale={locale} lastSeenCaption={lastSeenCaption} />

          <AgentRoster
            view={view}
            locale={locale}
            tz={tz}
            now={now}
            agentsForReassign={agentsForReassign}
            onSelectAgent={setSelected}
            onQueueChanged={() => void mutate()}
            onToast={onToast}
          />

          <div className="grid grid-cols-1 items-start gap-3.5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]">
            <BlockedOrdersCard blocked={live.blocked} locale={locale} onReassign={setReassignTarget} />
            <UpcomingCallbacksCard callbacks={live.callbacks_upcoming} locale={locale} tz={tz} />
          </div>
        </div>
      )}

      {/* Reassign one blocked order — a small choice sheet */}
      {reassignTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[rgba(26,26,26,0.5)]" onClick={() => setReassignTarget(null)}>
          <div className="w-[420px] max-w-[92vw] rounded-lg bg-surface-card p-5 shadow-floating" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-[15px] font-semibold text-ink-primary" dir="auto">{t("blocked.reassignTitle", { name: reassignTarget.customer_name ?? reassignTarget.external_id ?? "" })}</h3>
            <p className="mt-1 text-[12.5px] text-ink-secondary">{t("blocked.reassignHint")}</p>
            <div className="mt-4 flex flex-col gap-1.5">
              <button type="button" onClick={() => void reassignBlocked(null)} className="rounded-md border border-line-strong bg-surface-card px-3 py-2 text-start text-[13.5px] font-medium hover:bg-surface-hover">{t("roster.returnToPool")}</button>
              {agentsForReassign.filter((a) => a.id !== reassignTarget.agent_id).map((a) => (
                <button key={a.id} type="button" onClick={() => void reassignBlocked(a.id)} className="rounded-md border border-line-subtle bg-surface-card px-3 py-2 text-start text-[13.5px] hover:bg-surface-hover">{t("roster.reassignTo", { name: a.full_name })}</button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setReassignTarget(null)} className="rounded-md px-3 py-1.5 text-[13px] text-ink-secondary hover:bg-surface-hover">{t("blocked.cancel")}</button>
            </div>
          </div>
        </div>
      )}

      <AgentDrawer
        agentId={selected}
        onClose={() => setSelected(null)}
        marketId={marketId}
        locale={locale}
        tz={tz}
        live={live}
        defaultPeriod={defaultPeriod}
        now={now}
      />
    </div>
  );
}

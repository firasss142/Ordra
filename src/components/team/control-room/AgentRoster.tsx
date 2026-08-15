"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Clock, Inbox, Settings2, Target, User } from "lucide-react";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import type { LiveView, LiveAgentView } from "@/lib/team/view-models";
import type { LiveAgent } from "@/lib/team/types";
import { fmtAge, fmtNum, relativeParts } from "@/lib/team/format";
import { reassignAgentQueue } from "@/lib/team/reassign-queue";
import { AgentAvatar } from "./AgentAvatar";
import { GoalSegments } from "./GoalSegments";
import { TeamCard, TeamCardHead } from "./Card";

interface Props {
  view: LiveView;
  locale: string;
  tz: string;
  now: Date;
  agentsForReassign: { id: string; full_name: string }[];
  onSelectAgent: (agentId: string) => void;
  onQueueChanged: () => void;
  onToast: (msg: string, tone: "success" | "error") => void;
}

export function useRelativeLabel(locale: string, tz: string, now: Date) {
  const t = useTranslations("team.relative");
  return (iso: string): string => {
    const p = relativeParts(iso, now, locale, tz);
    switch (p.kind) {
      case "now":
        return t("now");
      case "minutes":
        return t("minutes", { n: p.value });
      case "hours":
        return t("hours", { n: p.value });
      case "yesterday":
        return t("yesterday", { time: p.time });
      default:
        return t("date", { date: p.date });
    }
  };
}

function ThIcon({ icon: Icon, label, className = "" }: { icon?: typeof User; label: string; className?: string }) {
  return (
    <th className={`whitespace-nowrap px-3.5 py-2.5 text-start text-[12px] font-medium text-ink-secondary ${className}`}>
      {Icon && <Icon size={14} className="me-1.5 inline-block -translate-y-px text-ink-muted" aria-hidden="true" />}
      {label}
    </th>
  );
}

function QueuePill({ a, locale }: { a: LiveAgent; locale: string }) {
  const t = useTranslations("team.live.roster.pill");
  const q = a.queue;
  if (q.total === 0) return null;
  if (q.confirmed_awaiting > 0 && q.oldest_days != null && q.exhausted === 0 && q.confirmed_awaiting === q.total) {
    return <span className="rounded-pill border border-status-critical bg-surface-card px-2.5 py-[3px] text-[12.5px] font-medium text-status-critical tabular-nums">{t("confAge", { age: fmtAge(locale, q.oldest_days) })}</span>;
  }
  if (q.overdue_callbacks > 0) {
    return <span className="rounded-pill border border-status-critical bg-surface-card px-2.5 py-[3px] text-[12.5px] font-medium text-status-critical tabular-nums">{t("overdue", { n: q.overdue_callbacks })}</span>;
  }
  if (q.older_24h > 0) {
    const label = q.oldest_days != null && q.oldest_days >= 2 && q.older_24h === q.total
      ? t("olderThan", { n: q.older_24h, age: fmtAge(locale, Math.floor(q.oldest_days)) })
      : t("older24", { n: q.older_24h });
    return <span className="rounded-pill border border-status-critical bg-surface-card px-2.5 py-[3px] text-[12.5px] font-medium text-status-critical tabular-nums">{label}</span>;
  }
  const onlyDispatch = q.by_product.length > 0 && q.by_product.every((p) => p.status === "dispatch_scheduled");
  if (onlyDispatch) {
    return <span className="rounded-pill border border-line bg-surface-page px-2.5 py-[3px] text-[12.5px] font-medium text-ink-secondary">{t("dispatch")}</span>;
  }
  return null;
}

export function AgentRoster({ view, locale, tz, now, agentsForReassign, onSelectAgent, onQueueChanged, onToast }: Props) {
  const t = useTranslations("team.live.roster");
  const tStatus = useTranslations("orders.statuses");
  const rel = useRelativeLabel(locale, tz, now);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);

  async function run(agentId: string, target: string | null) {
    setBusyAgent(agentId);
    try {
      const r = await reassignAgentQueue(agentId, target);
      if (r.failed > 0) onToast(t("reassignPartial", { ok: r.ok, failed: r.failed }), "error");
      else onToast(t("reassignDone", { n: r.ok }), "success");
      onQueueChanged();
    } catch {
      onToast(t("reassignFailed"), "error");
    } finally {
      setBusyAgent(null);
    }
  }

  function menuItems(a: LiveAgent): MenuItem[] {
    const others = agentsForReassign.filter((x) => x.id !== a.agent_id);
    return [
      { id: "pool", label: t("returnToPool"), onSelect: () => void run(a.agent_id, null) },
      ...others.map((o) => ({ id: o.id, label: t("reassignTo", { name: o.full_name }), onSelect: () => void run(a.agent_id, o.id) })),
    ];
  }

  function lastAction(av: LiveAgentView) {
    const a = av.agent;
    if (!a.last_action) return <span className="text-ink-muted">{t("noAction")}</span>;
    const label = tStatus.has(a.last_action.status_to) ? tStatus(a.last_action.status_to) : a.last_action.status_to;
    const daysIdle = Math.floor((now.getTime() - new Date(a.last_action.at).getTime()) / 86_400_000);
    return (
      <span className="whitespace-nowrap text-[14px]">
        {label} · <span className="text-ink-secondary">{rel(a.last_action.at)}</span>
        {daysIdle >= 3 && a.queue.total > 0 && (
          <>
            {" "}· <span className="font-medium text-status-critical">{t("idleFor", { days: daysIdle })}</span>
          </>
        )}
      </span>
    );
  }

  return (
    <TeamCard>
      <TeamCardHead title={t("title")} hint={t("hint")} />
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th colSpan={2} />
              <th colSpan={2} className="border-x border-line-subtle px-3.5 pt-2 text-center text-[12px] font-medium text-ink-secondary">
                {t("today")}
              </th>
              <th colSpan={3} />
            </tr>
            <tr className="border-b border-line">
              <ThIcon icon={User} label={t("agent")} />
              <ThIcon icon={Clock} label={t("lastAction")} />
              <ThIcon label={t("treated")} className="!text-center border-s border-line-subtle" />
              <ThIcon label={t("confirmed")} className="!text-center border-e border-line-subtle" />
              <ThIcon icon={Target} label={t("goals")} />
              <ThIcon icon={Inbox} label={t("queue")} className="!text-end" />
              <ThIcon icon={Settings2} label={t("action")} className="!text-center" />
            </tr>
          </thead>
          <tbody>
            {view.agents.map((av) => {
              const a = av.agent;
              const idle = av.goals.idle;
              const stripe = a.presence === "offline" && a.queue.total > 0 && a.last_action != null &&
                (now.getTime() - new Date(a.last_action.at).getTime()) / 86_400_000 >= 3;
              const busy = busyAgent === a.agent_id;
              const showPool = a.presence === "offline" && a.queue.total > 0;
              const showReassign = !showPool && a.queue.total > 0;
              return (
                <tr
                  key={a.agent_id}
                  className="cursor-pointer border-b border-line-subtle last:border-b-0 hover:bg-surface-hover"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button,[role=menu]")) return;
                    onSelectAgent(a.agent_id);
                  }}
                >
                  <td className={`px-3.5 py-3 ${stripe ? "shadow-[inset_3px_0_0_var(--critical,#D72C0D)]" : ""}`}>
                    <span className="flex items-center gap-2.5">
                      <AgentAvatar name={a.name} avatarUrl={a.avatar_url} presence={a.presence} ghost={idle} />
                      <span className="text-[14px] font-semibold text-ink-primary">{a.name}</span>
                    </span>
                  </td>
                  <td className="px-3.5 py-3">{lastAction(av)}</td>
                  <td className={`border-s border-line-subtle px-3.5 py-3 text-center tabular-nums ${idle ? "text-ink-muted" : ""}`}>{idle ? "—" : fmtNum(locale, a.today.treated)}</td>
                  <td className={`border-e border-line-subtle px-3.5 py-3 text-center tabular-nums ${idle ? "text-ink-muted" : ""}`}>{idle ? "—" : fmtNum(locale, a.today.confirmed)}</td>
                  <td className="px-3.5 py-3">
                    <GoalSegments goals={av.goals} muted={idle} title={t("goalsTitle", { v: av.goals.volume.value, vt: av.goals.volume.target, q: av.goals.quality.value ?? "—", qt: av.goals.quality.target, h: av.goals.hygiene.value })} />
                  </td>
                  <td className="px-3.5 py-3 text-end">
                    <span className="inline-flex items-center justify-end gap-2.5">
                      <b className={`text-[14px] font-semibold tabular-nums ${a.queue.total === 0 ? "text-ink-muted" : ""}`}>{fmtNum(locale, a.queue.total)}</b>
                      <QueuePill a={a} locale={locale} />
                    </span>
                  </td>
                  <td className="px-3.5 py-3 text-center">
                    {showPool ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(a.agent_id, null)}
                        className="rounded-md bg-brand px-3 py-[7px] text-[13px] font-medium text-white hover:bg-brand-hover disabled:opacity-60"
                      >
                        {t("returnToPool")}
                      </button>
                    ) : showReassign ? (
                      <Menu
                        ariaLabel={t("reassign")}
                        items={menuItems(a)}
                        trigger={
                          <button
                            type="button"
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-surface-card px-3 py-[7px] text-[13px] font-medium text-ink-primary hover:bg-surface-hover disabled:opacity-60"
                          >
                            {t("reassign")}
                            <ChevronDown size={13} aria-hidden="true" />
                          </button>
                        }
                      />
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </TeamCard>
  );
}

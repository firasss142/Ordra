"use client";

/**
 * « Équipe » — one card per agent, worst-served first.
 *
 * The ranking is deliberate: a hot prospect going cold in someone's queue
 * outranks a merely long backlog, because a hot one is lost in an hour and a
 * backlog is not. agentLoad() in lib/prospects/console.ts does the sorting so
 * every surface agrees on who needs help first.
 *
 * Design: prototypes/prospects-manager-v1.html (teamBody).
 */
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Flame, Scale } from "lucide-react";
import type { AgentLoadRanked } from "@/lib/prospects/console";
import { Alert, Avatar, Bar, CARD, Empty, fmt, OUTLINE, Pill } from "./ui";

export interface TeamTabProps {
  agents: AgentLoadRanked[];
  /** Calls one agent is asked to make in a day. */
  cap: number;
  locale: string;
  onSeeQueue: (agentId: string) => void;
  onGive: (agentId: string) => void;
  onRebalance: (fromId: string, toId: string, n: number) => void;
}

export function TeamTab({ agents, cap, locale, onSeeQueue, onGive, onRebalance }: TeamTabProps) {
  const t = useTranslations("prospects.console");

  /**
   * The pair worth acting on: whoever is sitting on hot prospects, and
   * whoever is free enough to take them.
   */
  const rebalance = useMemo(() => {
    const worst = agents.filter((a) => a.hot_waiting > 0).sort((a, b) => b.hot_waiting - a.hot_waiting)[0];
    if (!worst) return null;
    const free = agents
      .filter((a) => a.id !== worst.id && a.hot_waiting === 0)
      .sort((a, b) => a.open_leads - b.open_leads)[0];
    return free ? { worst, free } : null;
  }, [agents]);

  if (agents.length === 0) return <Empty>{t("empty.agents")}</Empty>;

  return (
    <div className="flex flex-col gap-3.5">
      {rebalance ? (
        <Alert
          tone="amber"
          icon={Scale}
          title={t("reb.title")}
          desc={t("reb.desc", {
            from: rebalance.worst.name,
            n: rebalance.worst.hot_waiting,
            minutes: rebalance.worst.last_touch_minutes ?? 0,
            to: rebalance.free.name,
          })}
          cta={t("reb.cta", { n: rebalance.worst.hot_waiting, to: rebalance.free.name })}
          onCta={() => onRebalance(rebalance.worst.id, rebalance.free.id, rebalance.worst.hot_waiting)}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => {
          const online = (a.last_touch_minutes ?? 9999) < 30;
          const tone = a.hot_waiting > 0 ? "border-[#FCA5A5]"
            : (a.late_callbacks ?? 0) >= 2 ? "border-[#FBBF24]"
            : "border-[#E5E7EB]";
          return (
            <article key={a.id} className={`flex flex-col gap-2.5 rounded-xl border bg-white px-4 py-3.5 ${tone}`}>
              <div className="flex items-center gap-2.5">
                <Avatar name={a.name} online={online} />
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[15px] font-bold text-[#111827] [unicode-bidi:plaintext]">{a.name}</b>
                  <small className="text-[12.5px] text-[#6B7280]">
                    {online
                      ? t("agt.online", { minutes: a.last_touch_minutes ?? 0 })
                      : a.last_touch_minutes === null ? t("agt.offline") : t("agt.idleShort")}
                  </small>
                </span>
                {a.hot_waiting > 0 ? (
                  <Pill tone="amber">
                    <Flame size={12} aria-hidden />
                    {t("agt.hotWait", { n: a.hot_waiting, minutes: a.last_touch_minutes ?? 0 })}
                  </Pill>
                ) : (
                  <Pill tone="green">{t("agt.noHot")}</Pill>
                )}
              </div>

              <div className="grid grid-cols-4 gap-1.5">
                <Stat label={t("agt.calls")} value={fmt(a.calls_today, locale)} />
                <Stat label={t("agt.reached")} value={fmt(a.reached_today ?? 0, locale)} />
                <Stat
                  label={t("agt.conv")}
                  value={fmt(a.converted_today, locale)}
                  sub={a.rate !== null ? `${fmt(a.rate, locale)} %` : undefined}
                />
                <Stat
                  label={t("agt.late")}
                  value={fmt(a.late_callbacks ?? 0, locale)}
                  tone={(a.late_callbacks ?? 0) >= 2 ? "amber" : undefined}
                />
              </div>

              <div className="flex items-center gap-2 text-[12.5px] text-[#6B7280]">
                <span>{t("agt.queue")} <b className="font-semibold tabular-nums text-[#111827]">{fmt(a.open_leads, locale)}</b></span>
                <Bar
                  pct={cap > 0 ? (a.calls_today / cap) * 100 : 0}
                  tone={a.calls_today >= cap ? "amber" : "brand"}
                  className="min-w-[70px] flex-1"
                />
                <span className="whitespace-nowrap">{t("agt.cap", { calls: a.calls_today, cap })}</span>
              </div>

              <div className="flex gap-2">
                <button type="button" onClick={() => onSeeQueue(a.id)} className={`h-[34px] flex-1 text-[13px] ${OUTLINE}`}>
                  {t("agt.seeQueue")}
                </button>
                <button type="button" onClick={() => onGive(a.id)} className={`h-[34px] flex-1 text-[13px] ${OUTLINE}`}>
                  {t("agt.give")}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "amber" }) {
  return (
    <span className={`flex flex-col items-center gap-0.5 rounded-lg px-1.5 py-2 text-center ${
      tone === "amber" ? "bg-[#FEF3C7]" : "bg-[#F9FAFB]"
    }`}>
      <b className={`text-[17px] font-bold leading-none tabular-nums ${tone === "amber" ? "text-[#92400E]" : "text-[#111827]"}`}>
        {value}
      </b>
      <span className="w-full truncate text-[11.5px] text-[#6B7280]">{sub ?? label}</span>
    </span>
  );
}

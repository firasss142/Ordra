"use client";

import { useMemo } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Panel, EmptyState } from "./Panel";
import type { PresenceAgent } from "@/lib/dashboard/summary";

interface TopPerformersProps {
  agents: PresenceAgent[];
  title: string;
  confirmedLabel: string;
  onlineCountTemplate: (online: number, total: number) => string;
  viewAllHref: string;
  viewAllLabel: string;
  emptyLabel: string;
}

function sortTop(agents: PresenceAgent[]): PresenceAgent[] {
  return [...agents].sort((a, b) => {
    if (b.confirmation_rate !== a.confirmation_rate) return b.confirmation_rate - a.confirmation_rate;
    return b.confirmed_today - a.confirmed_today;
  });
}

export function TopPerformers({
  agents,
  title,
  confirmedLabel,
  onlineCountTemplate,
  viewAllHref,
  viewAllLabel,
  emptyLabel,
}: TopPerformersProps) {
  const top3 = useMemo(() => sortTop(agents).slice(0, 3), [agents]);
  const onlineCount = agents.filter((a) => a.state === "online").length;
  const total = agents.length;

  return (
    <Panel title={title} minHeight={280}>
      {top3.length === 0 ? (
        <EmptyState label={emptyLabel} />
      ) : (
        <div className="flex flex-col gap-1.5">
          {top3.map((agent, idx) => (
            <div
              key={agent.agent_id}
              data-testid="top-performer-row"
              className="grid grid-cols-[auto_auto_1fr_auto] gap-3 items-center py-2 px-1 rounded-[6px] text-[13px] hover:bg-surface-hover transition-colors duration-fast"
            >
              <span
                className={`w-[22px] h-[22px] rounded-full inline-flex items-center justify-center text-[12px] font-semibold ${
                  idx === 0
                    ? "bg-ink-primary text-white"
                    : "bg-surface-selected text-ink-primary"
                }`}
              >
                {idx + 1}
              </span>
              <Avatar
                user={{ full_name: agent.full_name, avatar_url: agent.avatar_url }}
                size={28}
              />
              <div className="flex flex-col min-w-0">
                <span className="text-ink-primary font-medium truncate" title={agent.full_name}>
                  {agent.full_name}
                </span>
                <span className="text-[12px] text-ink-secondary tabular-nums">
                  {agent.confirmed_today} {confirmedLabel}
                </span>
              </div>
              <span className="text-ink-primary font-semibold tabular-nums">
                {agent.confirmation_rate.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-line-subtle flex items-center justify-between text-[12px] text-ink-secondary">
        <span>{onlineCountTemplate(onlineCount, total)}</span>
        <a href={viewAllHref} className="text-ink-primary font-medium no-underline">
          {viewAllLabel} <span aria-hidden="true">→</span>
        </a>
      </div>
    </Panel>
  );
}

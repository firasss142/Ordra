"use client";

import { useTranslations } from "next-intl";
import {
  Inbox,
  Phone,
  Calendar,
  CheckCircle,
  Archive,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { AgentQueueBuckets } from "@/hooks/useAgentQueue";

export interface AgentStats {
  assigned_count: number;
  actioned_count: number;
  confirmation_rate: number;
}

export type BucketKey =
  | "nouveau"
  | "a_rappeler"
  | "planifie"
  | "confirme"
  | "fermees";
export type AttemptSubfilter = "all" | 1 | 2 | 3;
export type PlanifieSubfilter = "all" | "rappel" | "livraison";

interface QueueHeaderProps {
  agentName: string;
  stats: AgentStats;
  buckets: AgentQueueBuckets | null;
  selectedBucket: BucketKey;
  onBucketChange: (bucket: BucketKey) => void;
  attemptSubfilter: AttemptSubfilter;
  onAttemptSubfilterChange: (sub: AttemptSubfilter) => void;
  planifieSubfilter: PlanifieSubfilter;
  onPlanifieSubfilterChange: (sub: PlanifieSubfilter) => void;
  onNewOrder?: () => void;
}

interface TabDef {
  key: BucketKey;
  icon: LucideIcon;
  labelKey: "new" | "toCallBack" | "scheduled" | "confirmed" | "closed";
}

const TABS: TabDef[] = [
  { key: "nouveau", icon: Inbox, labelKey: "new" },
  { key: "a_rappeler", icon: Phone, labelKey: "toCallBack" },
  { key: "planifie", icon: Calendar, labelKey: "scheduled" },
  { key: "confirme", icon: CheckCircle, labelKey: "confirmed" },
  { key: "fermees", icon: Archive, labelKey: "closed" },
];

function TabButton({
  tab,
  label,
  count,
  active,
  onClick,
}: {
  tab: TabDef;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "group inline-flex items-center gap-2 py-2.5 px-1 me-5",
        "text-[13px] transition-colors duration-fast",
        "border-b-2 -mb-px",
        active
          ? "font-semibold text-ink-primary border-accent"
          : "font-medium text-ink-secondary border-transparent hover:text-ink-primary",
      ].join(" ")}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{label}</span>
      <span
        className={[
          "text-[12px] tabular-nums",
          active ? "text-ink-primary" : "text-ink-muted",
        ].join(" ")}
      >
        {count}
      </span>
    </button>
  );
}

function SubChip({
  active,
  count,
  onClick,
  children,
  srLabel,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
  srLabel: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-current={active ? "true" : undefined}
      aria-label={srLabel}
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 py-1 px-2.5 rounded-pill",
        "text-[12px] font-medium transition-colors duration-fast border",
        active
          ? "bg-ink-primary text-white border-ink-primary"
          : "bg-transparent text-ink-primary border-line hover:bg-surface-hover",
      ].join(" ")}
    >
      <span>{children}</span>
      <span className="tabular-nums opacity-85">{count}</span>
    </button>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[13px] text-ink-secondary">{label}</span>
      <span className="text-[13px] font-semibold tabular-nums text-ink-primary">
        {value}
      </span>
    </span>
  );
}

export function QueueHeader({
  agentName,
  stats,
  buckets,
  selectedBucket,
  onBucketChange,
  attemptSubfilter,
  onAttemptSubfilterChange,
  planifieSubfilter,
  onPlanifieSubfilterChange,
  onNewOrder,
}: QueueHeaderProps) {
  const t = useTranslations("queue");
  const tSub = useTranslations("queue.buckets.subfilter");
  const tPlan = useTranslations("queue.buckets.planifieSubfilter");
  const tOrders = useTranslations("orders.create");

  const counts = buckets ?? {
    nouveau: 0,
    tentative_1: 0,
    tentative_2: 0,
    tentative_3: 0,
    tentative_total: 0,
    rappel_prevu: 0,
    livraison_planifiee: 0,
    confirme: 0,
    rejete: 0,
    fermees: 0,
  };

  const planifieTotal = counts.rappel_prevu + counts.livraison_planifiee;

  const bucketCount: Record<BucketKey, number> = {
    nouveau: counts.nouveau,
    a_rappeler: counts.tentative_total,
    planifie: planifieTotal,
    confirme: counts.confirme,
    fermees: counts.fermees,
  };

  const attemptSubfilterDefs: Array<{
    key: AttemptSubfilter;
    label: string;
    count: number;
  }> = [
    { key: "all", label: tSub("all"), count: counts.tentative_total },
    { key: 1, label: tSub("t1"), count: counts.tentative_1 },
    { key: 2, label: tSub("t2"), count: counts.tentative_2 },
    { key: 3, label: tSub("t3"), count: counts.tentative_3 },
  ];

  const planifieSubfilterDefs: Array<{
    key: PlanifieSubfilter;
    label: string;
    count: number;
  }> = [
    { key: "all", label: tPlan("all"), count: planifieTotal },
    { key: "rappel", label: tPlan("rappel"), count: counts.rappel_prevu },
    {
      key: "livraison",
      label: tPlan("livraison"),
      count: counts.livraison_planifiee,
    },
  ];

  return (
    <div className="bg-surface-card border-b border-line-subtle px-6 pt-3.5 pb-0">
      {/* Top row — agent name + inline stats + new order */}
      <div className="flex items-center justify-between min-h-[40px]">
        <span className="text-[15px] font-semibold text-ink-primary tracking-tight">
          {agentName}
        </span>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-3 text-[13px]">
            <StatPill label={t("stats.assigned")} value={String(stats.assigned_count)} />
            <span className="text-line" aria-hidden="true">·</span>
            <StatPill label={t("stats.actioned")} value={String(stats.actioned_count)} />
            <span className="text-line" aria-hidden="true">·</span>
            <StatPill
              label={t("stats.confirmationRate")}
              value={`${stats.confirmation_rate.toFixed(1)}%`}
            />
          </div>
          {onNewOrder && (
            <Button size="sm" onClick={onNewOrder}>
              {tOrders("newOrder")}
            </Button>
          )}
        </div>
      </div>

      {/* Bucket tabs */}
      <div
        role="tablist"
        aria-label={t("title")}
        className="flex flex-wrap mt-2 border-b border-line-subtle -mx-6 px-6"
      >
        {TABS.map((tab) => (
          <TabButton
            key={tab.key}
            tab={tab}
            label={t(`buckets.${tab.labelKey}`)}
            count={bucketCount[tab.key]}
            active={selectedBucket === tab.key}
            onClick={() => onBucketChange(tab.key)}
          />
        ))}
      </div>

      {/* Sub-filter chips — À rappeler */}
      {selectedBucket === "a_rappeler" && (
        <div className="flex gap-1.5 mt-3 mb-3 flex-wrap">
          {attemptSubfilterDefs.map(({ key, label, count }) => (
            <SubChip
              key={String(key)}
              active={attemptSubfilter === key}
              count={count}
              srLabel={label}
              onClick={() => onAttemptSubfilterChange(key)}
            >
              {label}
            </SubChip>
          ))}
        </div>
      )}

      {/* Sub-filter chips — Planifié */}
      {selectedBucket === "planifie" && (
        <div className="flex gap-1.5 mt-3 mb-3 flex-wrap">
          {planifieSubfilterDefs.map(({ key, label, count }) => (
            <SubChip
              key={key}
              active={planifieSubfilter === key}
              count={count}
              srLabel={label}
              onClick={() => onPlanifieSubfilterChange(key)}
            >
              {label}
            </SubChip>
          ))}
        </div>
      )}
    </div>
  );
}

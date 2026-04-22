"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Inbox,
  Phone,
  Calendar,
  CheckCircle,
  Archive,
  type LucideIcon,
} from "lucide-react";
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
  const [hovered, setHovered] = useState(false);
  const Icon = tab.icon;

  const color = active
    ? "var(--text-primary)"
    : hovered
      ? "var(--text-primary)"
      : "var(--text-secondary)";

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        appearance: "none",
        background: "transparent",
        border: "none",
        padding: "10px 4px",
        marginInlineEnd: 20,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color,
        cursor: "pointer",
        borderBlockEnd: active
          ? "2px solid var(--text-primary)"
          : "2px solid transparent",
        transition: "color 120ms ease, border-color 120ms ease",
      }}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
      <span>{label}</span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: active ? "var(--text-primary)" : "var(--text-secondary)",
          fontVariantNumeric: "tabular-nums",
        }}
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
  const [hovered, setHovered] = useState(false);

  const background = active
    ? "var(--text-primary)"
    : hovered
      ? "var(--bg-hover)"
      : "transparent";
  const color = active ? "#FFFFFF" : "var(--text-primary)";
  const borderColor = active ? "var(--text-primary)" : "var(--border)";

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-current={active ? "true" : undefined}
      aria-label={srLabel}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        appearance: "none",
        padding: "4px 10px",
        borderRadius: 9999,
        border: `1px solid ${borderColor}`,
        background,
        color,
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        transition:
          "background-color 120ms ease, color 120ms ease, border-color 120ms ease",
      }}
    >
      <span>{children}</span>
      <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.85 }}>
        {count}
      </span>
    </button>
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
    <div
      style={{
        backgroundColor: "var(--bg-card)",
        borderBottom: "1px solid var(--border)",
        padding: "16px 24px",
      }}
    >
      {/* Top row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
          {agentName}
        </span>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 14,
            color: "var(--text-secondary)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center" }}>
            <span>
              {t("stats.assigned")}:{" "}
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                {stats.assigned_count}
              </span>
            </span>
            <span style={{ margin: "0 8px", color: "var(--border)" }}>|</span>
            <span>
              {t("stats.actioned")}:{" "}
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                {stats.actioned_count}
              </span>
            </span>
            <span style={{ margin: "0 8px", color: "var(--border)" }}>|</span>
            <span>
              {t("stats.confirmationRate")}:{" "}
              <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                {stats.confirmation_rate.toFixed(1)}%
              </span>
            </span>
          </div>
          {onNewOrder && (
            <button
              onClick={onNewOrder}
              style={{
                height: 32,
                padding: "0 16px",
                fontSize: 13,
                fontWeight: 500,
                backgroundColor: "var(--text-primary)",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {tOrders("newOrder")}
            </button>
          )}
        </div>
      </div>

      {/* Bucket tabs */}
      <div
        role="tablist"
        aria-label={t("title")}
        style={{
          display: "flex",
          marginTop: 12,
          flexWrap: "wrap",
          borderBottom: "1px solid var(--border)",
          marginInline: -24,
          paddingInline: 24,
        }}
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
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 12,
            flexWrap: "wrap",
          }}
        >
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
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 12,
            flexWrap: "wrap",
          }}
        >
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

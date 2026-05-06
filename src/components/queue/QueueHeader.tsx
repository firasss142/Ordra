"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Inbox,
  Phone,
  Calendar,
  CheckCircle,
  Archive,
  ListTodo,
  ChevronDown,
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
  | "en_cours"
  | "confirme"
  | "fermees";

export type EnCoursSubfilter = "all" | "rappel" | "tentative" | "livraison";
export type TentativeSubfilter = "all" | 1 | 2 | 3;

interface QueueHeaderProps {
  agentName: string;
  stats: AgentStats;
  buckets: AgentQueueBuckets | null;
  selectedBucket: BucketKey;
  onBucketChange: (bucket: BucketKey) => void;
  enCoursSubfilter: EnCoursSubfilter;
  onEnCoursSubfilterChange: (sub: EnCoursSubfilter) => void;
  tentativeSubfilter: TentativeSubfilter;
  onTentativeSubfilterChange: (sub: TentativeSubfilter) => void;
  onNewOrder?: () => void;
}

interface TabDef {
  key: BucketKey;
  icon: LucideIcon;
  labelKey: "new" | "inProgress" | "confirmed" | "closed";
}

const TABS: TabDef[] = [
  { key: "nouveau", icon: Inbox, labelKey: "new" },
  { key: "en_cours", icon: ListTodo, labelKey: "inProgress" },
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
          "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-pill tabular-nums text-[11px] font-medium",
          active
            ? "bg-ink-primary text-white"
            : "bg-surface-page border border-line-subtle text-ink-secondary",
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
  trailing,
  buttonRef,
  ariaHaspopup,
  ariaExpanded,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
  srLabel: string;
  trailing?: React.ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
  ariaHaspopup?: boolean;
  ariaExpanded?: boolean;
}) {
  return (
    <button
      type="button"
      ref={buttonRef}
      aria-pressed={active}
      aria-current={active ? "true" : undefined}
      aria-label={srLabel}
      aria-haspopup={ariaHaspopup ? "menu" : undefined}
      aria-expanded={ariaHaspopup ? ariaExpanded : undefined}
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 py-1 px-2.5 rounded-pill",
        "text-[12px] font-medium transition-colors duration-fast border",
        active
          ? "bg-ink-primary text-white border-ink-primary"
          : "bg-surface-page text-ink-secondary border-line-subtle hover:bg-surface-hover hover:text-ink-primary",
      ].join(" ")}
    >
      <span>{children}</span>
      <span className="tabular-nums">{count}</span>
      {trailing}
    </button>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-surface-page border border-line-subtle rounded-pill py-0.5 px-2.5">
      <span className="text-[12px] text-ink-secondary">{label}</span>
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
  enCoursSubfilter,
  onEnCoursSubfilterChange,
  tentativeSubfilter,
  onTentativeSubfilterChange,
  onNewOrder,
}: QueueHeaderProps) {
  const t = useTranslations("queue");
  const tEnCours = useTranslations("queue.buckets.enCoursSubfilter");
  const tAttempt = useTranslations("queue.buckets.subfilter");
  const tOrders = useTranslations("orders.create");

  const [tentativePopoverOpen, setTentativePopoverOpen] = useState(false);
  const tentativeAnchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close popover on outside click / Escape
  useEffect(() => {
    if (!tentativePopoverOpen) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (
        tentativeAnchorRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return;
      }
      setTentativePopoverOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setTentativePopoverOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [tentativePopoverOpen]);

  // Close popover when leaving the en_cours bucket
  useEffect(() => {
    if (selectedBucket !== "en_cours") setTentativePopoverOpen(false);
  }, [selectedBucket]);

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

  const enCoursTotal =
    counts.tentative_total + counts.rappel_prevu + counts.livraison_planifiee;

  const bucketCount: Record<BucketKey, number> = {
    nouveau: counts.nouveau,
    en_cours: enCoursTotal,
    confirme: counts.confirme,
    fermees: counts.fermees,
  };

  const tentativeChipActive =
    enCoursSubfilter === "tentative" || tentativePopoverOpen;

  function handleTentativeChipClick() {
    // Open: filter to all attempts and reveal T1/T2/T3.
    // Click again while open: just close — the chip stays as the active filter.
    if (tentativePopoverOpen) {
      setTentativePopoverOpen(false);
      return;
    }
    if (enCoursSubfilter !== "tentative") onEnCoursSubfilterChange("tentative");
    setTentativePopoverOpen(true);
  }

  function handleTentativeOptionClick(value: TentativeSubfilter) {
    onTentativeSubfilterChange(value);
    setTentativePopoverOpen(false);
  }

  return (
    <div className="bg-surface-card border-b border-line-subtle px-6 pt-4 pb-0">
      {/* Top row — agent name + inline stats + new order */}
      <div className="flex items-center justify-between min-h-[40px]">
        <span className="text-[17px] font-semibold text-ink-primary tracking-tight">
          {agentName}
        </span>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2">
            <StatPill label={t("stats.assigned")} value={String(stats.assigned_count)} />
            <StatPill label={t("stats.actioned")} value={String(stats.actioned_count)} />
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
        className="flex flex-wrap mt-1.5 border-b border-line-subtle -mx-6 px-6"
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

      {/* Sub-filter chips — En cours */}
      {selectedBucket === "en_cours" && (
        <div className="flex gap-1.5 mt-2.5 mb-3 flex-wrap">
          <SubChip
            active={enCoursSubfilter === "all"}
            count={enCoursTotal}
            srLabel={tEnCours("all")}
            onClick={() => onEnCoursSubfilterChange("all")}
          >
            {tEnCours("all")}
          </SubChip>

          <SubChip
            active={enCoursSubfilter === "rappel"}
            count={counts.rappel_prevu}
            srLabel={tEnCours("rappel")}
            onClick={() => onEnCoursSubfilterChange("rappel")}
          >
            <Phone size={12} strokeWidth={2} aria-hidden="true" className="me-1 inline" />
            {tEnCours("rappel")}
          </SubChip>

          {/* Tentative chip + popover */}
          <div className="relative inline-block">
            <SubChip
              buttonRef={tentativeAnchorRef}
              active={tentativeChipActive}
              count={
                tentativeSubfilter === 1
                  ? counts.tentative_1
                  : tentativeSubfilter === 2
                    ? counts.tentative_2
                    : tentativeSubfilter === 3
                      ? counts.tentative_3
                      : counts.tentative_total
              }
              srLabel={tEnCours("tentative")}
              ariaHaspopup
              ariaExpanded={tentativePopoverOpen}
              onClick={handleTentativeChipClick}
              trailing={
                <ChevronDown
                  size={12}
                  strokeWidth={2}
                  aria-hidden="true"
                  className={[
                    "ms-0.5 transition-transform duration-fast",
                    tentativePopoverOpen ? "rotate-180" : "",
                  ].join(" ")}
                />
              }
            >
              {tEnCours("tentative")}
              {tentativeSubfilter !== "all" && (
                <span className="ms-1 text-[11px] opacity-80">
                  · {tentativeSubfilter}
                </span>
              )}
            </SubChip>

            {tentativePopoverOpen && (
              <div
                ref={popoverRef}
                role="menu"
                aria-label={tEnCours("tentative")}
                className="absolute z-20 mt-1 start-0 min-w-[160px] bg-surface-card border border-line-subtle rounded-card shadow-floating py-1"
              >
                <TentativePopoverItem
                  active={tentativeSubfilter === "all"}
                  count={counts.tentative_total}
                  label={tAttempt("all")}
                  onClick={() => handleTentativeOptionClick("all")}
                />
                <TentativePopoverItem
                  active={tentativeSubfilter === 1}
                  count={counts.tentative_1}
                  label={tAttempt("t1")}
                  onClick={() => handleTentativeOptionClick(1)}
                />
                <TentativePopoverItem
                  active={tentativeSubfilter === 2}
                  count={counts.tentative_2}
                  label={tAttempt("t2")}
                  onClick={() => handleTentativeOptionClick(2)}
                />
                <TentativePopoverItem
                  active={tentativeSubfilter === 3}
                  count={counts.tentative_3}
                  label={tAttempt("t3")}
                  onClick={() => handleTentativeOptionClick(3)}
                />
              </div>
            )}
          </div>

          <SubChip
            active={enCoursSubfilter === "livraison"}
            count={counts.livraison_planifiee}
            srLabel={tEnCours("livraison")}
            onClick={() => onEnCoursSubfilterChange("livraison")}
          >
            <Calendar size={12} strokeWidth={2} aria-hidden="true" className="me-1 inline" />
            {tEnCours("livraison")}
          </SubChip>
        </div>
      )}
    </div>
  );
}

function TentativePopoverItem({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={label}
      onClick={onClick}
      className={[
        "w-full flex items-center justify-between gap-3 px-3 py-1.5",
        "text-[12px] font-medium text-start transition-colors duration-fast",
        active
          ? "bg-surface-hover text-ink-primary"
          : "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary",
      ].join(" ")}
    >
      <span>{label}</span>
      <span className="tabular-nums text-[11px] text-ink-muted">{count}</span>
    </button>
  );
}

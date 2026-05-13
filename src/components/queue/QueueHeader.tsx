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
  Plus,
  UploadCloud,
  Truck,
  XCircle,
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
  | "en_cours"
  | "confirme"
  | "fermees";

export type EnCoursSubfilter = "all" | "rappel" | "tentative" | "livraison";
export type TentativeSubfilter = "all" | 1 | 2 | 3;
export type ClosedSubfilter = "all" | "uploaded" | "rejected" | "dispatched";

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
  closedSubfilter: ClosedSubfilter;
  onClosedSubfilterChange: (sub: ClosedSubfilter) => void;
  closedCounts: Record<ClosedSubfilter, number>;
  onNewOrder?: () => void;
}

interface TabDef {
  key: BucketKey;
  icon: LucideIcon;
  labelKey: "new" | "inProgress" | "confirmed" | "closed";
  /** Visual tone reflecting the lifecycle phase — active state colors */
  tone: "neutral" | "warning" | "success" | "archive";
}

const TABS: TabDef[] = [
  { key: "nouveau", icon: Inbox, labelKey: "new", tone: "neutral" },
  { key: "en_cours", icon: ListTodo, labelKey: "inProgress", tone: "warning" },
  { key: "confirme", icon: CheckCircle, labelKey: "confirmed", tone: "success" },
  { key: "fermees", icon: Archive, labelKey: "closed", tone: "archive" },
];

const CLOSED_STATUS_CHIPS: Array<{
  key: Exclude<ClosedSubfilter, "all">;
  icon: LucideIcon;
}> = [
  { key: "uploaded", icon: UploadCloud },
  { key: "rejected", icon: XCircle },
  { key: "dispatched", icon: Truck },
];

// Active-state token sets per tone. Each tab lights up in its lifecycle color
// only when selected, keeping the segmented control quiet at rest.
const TAB_TONE: Record<
  TabDef["tone"],
  { activeBg: string; activeText: string; activeBorder: string; chipBg: string; chipText: string; iconActive: string }
> = {
  neutral: {
    activeBg: "bg-[#EEF2F7]",
    activeText: "text-[#1E3A5F]",
    activeBorder: "border-[#C7D2E0]",
    chipBg: "bg-[#1E3A5F]",
    chipText: "text-white",
    iconActive: "text-[#1E3A5F]",
  },
  warning: {
    activeBg: "bg-[#FEF4E2]",
    activeText: "text-[#8A5A00]",
    activeBorder: "border-[#F0C97D]",
    chipBg: "bg-[#B07A00]",
    chipText: "text-white",
    iconActive: "text-[#8A5A00]",
  },
  success: {
    activeBg: "bg-[#DFF8EC]",
    activeText: "text-[#004D35]",
    activeBorder: "border-[#10B981]",
    chipBg: "bg-[#007A52]",
    chipText: "text-white",
    iconActive: "text-[#008060]",
  },
  archive: {
    activeBg: "bg-agent-surface-high",
    activeText: "text-agent-on-surface",
    activeBorder: "border-agent-outline",
    chipBg: "bg-agent-on-surface-variant",
    chipText: "text-white",
    iconActive: "text-agent-on-surface",
  },
};

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
  const tone = TAB_TONE[tab.tone];
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        "group relative inline-flex items-center gap-2 py-2 px-4 rounded-xl",
        "text-[13.5px] font-semibold transition-all duration-fast",
        active
          ? `${tone.activeBg} ${tone.activeText} shadow-[0_1px_2px_rgba(16,24,40,0.04)] border ${tone.activeBorder}`
          : "text-agent-on-surface-variant hover:text-agent-on-surface hover:bg-agent-surface-low/60 border border-transparent",
      ].join(" ")}
    >
      <Icon
        size={15}
        strokeWidth={active ? 2.5 : 2}
        aria-hidden="true"
        className={active ? tone.iconActive : "text-agent-on-surface-variant/70"}
      />
      <span>{label}</span>
      <span
        className={[
          "inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-pill tabular-nums text-[11px] font-bold",
          active ? `${tone.chipBg} ${tone.chipText}` : "bg-agent-surface-high text-agent-on-surface-variant/80",
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
        "text-[11.5px] font-semibold transition-colors duration-fast",
        active
          ? "bg-agent-on-surface/90 text-white"
          : "bg-transparent text-agent-on-surface-variant hover:bg-agent-surface-high/60 hover:text-agent-on-surface",
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
    <span className="inline-flex items-center gap-1.5 bg-agent-surface border border-agent-outline-variant rounded-pill py-1 px-3">
      <span className="text-[12px] text-agent-on-surface-variant">{label}</span>
      <span className="text-[13px] font-bold tabular-nums text-agent-on-surface">
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
  closedSubfilter,
  onClosedSubfilterChange,
  closedCounts,
  onNewOrder,
}: QueueHeaderProps) {
  const t = useTranslations("queue");
  const tEnCours = useTranslations("queue.buckets.enCoursSubfilter");
  const tAttempt = useTranslations("queue.buckets.subfilter");
  const tClosed = useTranslations("queue.buckets.closedSubfilter");

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

  const tShell = useTranslations("queue.agentShell");

  return (
    <div className="bg-agent-bg px-8 pt-6 pb-2">
      {/* Title row — live queue title + subtitle on lead edge,
          stats + new order on trail edge */}
      <div className="flex items-end justify-between gap-4 mb-5 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold text-agent-on-surface leading-tight tracking-tight">
            {tShell("liveQueueTitle")}
          </h1>
          <p className="text-[13px] text-agent-on-surface-variant mt-1">
            {agentName
              ? tShell("liveQueueSubtitleWithName", { name: agentName })
              : tShell("liveQueueSubtitle")}
          </p>
        </div>

        <div className="hidden md:flex items-center gap-2">
          <StatPill label={t("stats.assigned")} value={String(stats.assigned_count)} />
          <StatPill label={t("stats.actioned")} value={String(stats.actioned_count)} />
          <StatPill
            label={t("stats.confirmationRate")}
            value={`${stats.confirmation_rate.toFixed(1)}%`}
          />
        </div>
      </div>

      {/* Bucket segmented control + primary "New Order" CTA on the row's
          trailing edge (which is the left side in RTL Arabic, right in LTR).
          Each tab lights up in its lifecycle tone when selected. */}
      <div className="flex items-center gap-4">
        <div className="overflow-x-auto min-w-0 -mx-1 px-1 custom-scrollbar">
          <div
            role="tablist"
            aria-label={t("title")}
            className="inline-flex items-center gap-1 p-1 bg-agent-surface rounded-2xl border border-agent-outline-variant shadow-[0_1px_2px_rgba(16,24,40,0.02)]"
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
        </div>

        {onNewOrder && (
          <button
            type="button"
            onClick={onNewOrder}
            className="ms-auto shrink-0 inline-flex items-center gap-1.5 h-10 px-5 rounded-pill bg-agent-primary text-white text-[13.5px] font-bold hover:bg-agent-on-primary-container transition-colors duration-fast"
          >
            <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
            <span>{tShell("newOrder")}</span>
          </button>
        )}
      </div>

      {/* Sub-filter chips — En cours. Visually subordinate to the segmented control above:
          smaller, ghost-style, with a "Filter:" label so users see the relationship. */}
      {selectedBucket === "en_cours" && (
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-agent-on-surface-variant me-1">
            {tShell("filterLabel")}
          </span>
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
                className="absolute z-20 mt-1 start-0 min-w-[160px] bg-agent-surface border border-agent-outline-variant rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.06)] py-1"
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

      {selectedBucket === "fermees" && (
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          <SubChip
            active={closedSubfilter === "all"}
            count={closedCounts.all}
            srLabel={tClosed("all")}
            onClick={() => onClosedSubfilterChange("all")}
          >
            {tClosed("all")}
          </SubChip>

          {CLOSED_STATUS_CHIPS.map(({ key, icon: Icon }) => (
            <SubChip
              key={key}
              active={closedSubfilter === key}
              count={closedCounts[key]}
              srLabel={tClosed(key)}
              onClick={() => onClosedSubfilterChange(key)}
            >
              <Icon size={12} strokeWidth={2} aria-hidden="true" className="me-1 inline" />
              {tClosed(key)}
            </SubChip>
          ))}
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
        "w-full flex items-center justify-between gap-3 px-3 py-2",
        "text-[12px] font-semibold text-start transition-colors duration-fast",
        active
          ? "bg-agent-primary/10 text-agent-on-primary-container"
          : "text-agent-on-surface-variant hover:bg-agent-surface-low hover:text-agent-on-surface",
      ].join(" ")}
    >
      <span>{label}</span>
      <span className="tabular-nums text-[11px] text-ink-muted">{count}</span>
    </button>
  );
}

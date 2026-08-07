"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Inbox,
  CheckCircle,
  Archive,
  ListTodo,
  ChevronDown,
  Plus,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { StatusGlyph, type StatusGlyphShape } from "@/components/shared/StatusGlyph";
import { presentStatus, type StatusHue } from "@/lib/orders/status-presentation";
import type { AgentQueueBuckets } from "@/hooks/useAgentQueue";

export interface AgentStats {
  assigned_count: number;
  actioned_count: number;
  confirmation_rate: number;
}

export type BucketKey = "nouveau" | "en_cours" | "confirme" | "fermees";

export type EnCoursSubfilter = "all" | "rappel" | "tentative" | "livraison";
export type TentativeSubfilter = "all" | 1 | 2 | 3;
export type ClosedSubfilter =
  | "all"
  | "uploaded"
  | "deposit"
  | "delivered"
  | "returned"
  | "cancelled"
  | "rejected";

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
  onRefreshDexpress?: () => void;
  refreshingDexpress?: boolean;
  onNewOrder?: () => void;
  /**
   * From settings.max_call_attempts. When > 3, the third popover item is
   * relabeled "Tentative 3+" because the status enum tops out at attempt_3
   * and that bucket actually covers attempts 3..max.
   */
  maxAttempts?: number;
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

/**
 * Sub-filter chips carry the hue and glyph of the status they filter for, so
 * choosing a filter and reading the rows it reveals is one continuous thought.
 * Both are derived from the shared presentation map rather than restated —
 * a chip and its pills cannot disagree.
 */
function chipFace(status: string | null): { hue: StatusHue | null; glyph: StatusGlyphShape | null } {
  if (!status) return { hue: null, glyph: null };
  const p = presentStatus(status);
  return { hue: p.hue, glyph: p.glyph };
}

/** Chip tone per hue. Rest is transparent; only the selected chip takes a tint. */
const CHIP_HUE: Record<StatusHue, string> = {
  neutral: "bg-hue-neutral-bg text-hue-neutral-ink border-hue-neutral-edge/40",
  amber: "bg-hue-amber-bg text-hue-amber-ink border-hue-amber-edge/40",
  violet: "bg-hue-violet-bg text-hue-violet-ink border-hue-violet-edge/40",
  teal: "bg-hue-teal-bg text-hue-teal-ink border-hue-teal-edge/40",
  green: "bg-hue-green-bg text-hue-green-ink border-hue-green-edge/40",
  red: "bg-hue-red-bg text-hue-red-ink border-hue-red-edge/40",
};

const CHIP_GLYPH_HUE: Record<StatusHue, string> = {
  neutral: "text-hue-neutral-edge",
  amber: "text-hue-amber-edge",
  violet: "text-hue-violet-edge",
  teal: "text-hue-teal-edge",
  green: "text-hue-green-edge",
  red: "text-hue-red-edge",
};

/**
 * Level 1 — a bucket. Where am I?
 *
 * Underline tabs on the page ground: bigger type than the filters below, an
 * icon, and a count that only fills green when selected, so exactly one tab is
 * unmistakably current.
 */
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
        "group/tab relative inline-flex flex-1 items-center justify-center gap-2 sm:flex-none",
        "h-[46px] whitespace-nowrap px-2.5 text-[13px] sm:h-[52px] sm:px-3.5 sm:text-[14px]",
        "font-semibold transition-colors duration-base",
        active ? "text-agent-on-surface" : "text-agent-ink-3 hover:text-agent-on-surface",
      ].join(" ")}
    >
      <Icon
        size={15}
        strokeWidth={active ? 2.25 : 2}
        aria-hidden="true"
        className={[
          "hidden shrink-0 transition-opacity duration-base sm:inline",
          active ? "opacity-100" : "opacity-55 group-hover/tab:opacity-100",
        ].join(" ")}
      />
      <span className="truncate">{label}</span>
      <span
        className={[
          "grid h-5 min-w-[21px] shrink-0 place-items-center rounded-pill px-1.5",
          "text-[11px] font-bold tabular-nums transition-colors duration-base",
          active
            ? "bg-agent-primary text-agent-on-primary"
            : "bg-agent-surface-low text-agent-ink-3",
        ].join(" ")}
      >
        {count}
      </span>
      {/* The indicator is always in the DOM so switching tabs animates a colour
          rather than inserting a box and nudging the row. */}
      <span
        aria-hidden="true"
        className={[
          "absolute inset-x-2 bottom-0 h-[2.5px] rounded-t-[3px] transition-colors duration-base",
          active
            ? "bg-agent-primary"
            : "bg-transparent group-hover/tab:bg-agent-outline",
        ].join(" ")}
      />
    </button>
  );
}

/**
 * Level 2 — a sub-filter. Narrowing what I'm already inside.
 *
 * Deliberately lighter than a tab: smaller, borderless at rest, and living in a
 * recessed panel. An inverted dark slab (the old active state) read as a
 * different component rather than as a state.
 */
function FilterChip({
  active,
  count,
  onClick,
  label,
  status,
  trailing,
  buttonRef,
  ariaHaspopup,
  ariaExpanded,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  label: string;
  /** The status this chip filters for; drives its hue + glyph. Null for "all". */
  status: string | null;
  trailing?: React.ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
  ariaHaspopup?: boolean;
  ariaExpanded?: boolean;
}) {
  const { hue, glyph } = chipFace(status);
  return (
    <button
      type="button"
      ref={buttonRef}
      aria-pressed={active}
      aria-label={`${label} — ${count}`}
      aria-haspopup={ariaHaspopup ? "menu" : undefined}
      aria-expanded={ariaHaspopup ? ariaExpanded : undefined}
      onClick={onClick}
      className={[
        "inline-flex h-[30px] shrink-0 items-center gap-[7px] rounded-lg border px-2.5",
        "text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-fast",
        active
          ? hue
            ? CHIP_HUE[hue]
            : "border-agent-outline bg-agent-surface text-agent-on-surface"
          : "border-transparent bg-transparent text-agent-on-surface-variant hover:border-agent-outline-variant hover:bg-agent-surface hover:text-agent-on-surface",
      ].join(" ")}
    >
      {glyph && hue && (
        <span
          aria-hidden="true"
          className={[
            "grid w-2 flex-none place-items-center transition-opacity duration-fast",
            active ? "opacity-100" : `${CHIP_GLYPH_HUE[hue]} opacity-60`,
          ].join(" ")}
        >
          <StatusGlyph shape={glyph} tone="inherit" />
        </span>
      )}
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={`flex-none tabular-nums font-bold ${active ? "opacity-85" : "opacity-60"}`}
      >
        {count}
      </span>
      {trailing}
    </button>
  );
}

/** A shift readout, not navigation — so it gets no pill chrome. */
function MeterCell({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col items-end gap-px border-s border-agent-outline-variant px-4 first:border-s-0">
      <span className="text-[15px] font-bold leading-tight tabular-nums text-agent-on-surface">
        {value}
      </span>
      <span className="whitespace-nowrap text-[10px] font-semibold tracking-[0.07em] text-agent-ink-3">
        {label}
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
  onRefreshDexpress,
  refreshingDexpress = false,
  onNewOrder,
  maxAttempts = 3,
}: QueueHeaderProps) {
  const t = useTranslations("queue");
  const tEnCours = useTranslations("queue.buckets.enCoursSubfilter");
  const tAttempt = useTranslations("queue.buckets.subfilter");
  const tClosed = useTranslations("queue.buckets.closedSubfilter");
  const tShell = useTranslations("queue.agentShell");

  const [tentativePopoverOpen, setTentativePopoverOpen] = useState(false);
  const tentativeAnchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

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

  // Status enum caps at attempt_3, so the T3 bucket actually holds attempts
  // 3..max. Relabel as "3+" when max > 3 so agents see the bucket is collective.
  const t3Plus = maxAttempts > 3;
  const t3Label = t3Plus ? tAttempt("t3Plus") : tAttempt("t3");
  const tentativeBadge: string =
    tentativeSubfilter === "all"
      ? ""
      : tentativeSubfilter === 3 && t3Plus
        ? "3+"
        : String(tentativeSubfilter);

  const showSubfilters = selectedBucket === "en_cours" || selectedBucket === "fermees";

  return (
    <div className="bg-agent-bg px-4 pt-4 sm:px-5 sm:pt-5">
      {/* Title row — identity on the lead edge, shift readout and the single
          filled CTA on the trail edge. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate text-[20px] font-bold leading-tight tracking-[-0.015em] text-agent-on-surface">
            {tShell("liveQueueTitle")}
          </h1>
          <span className="hidden whitespace-nowrap text-[12.5px] text-agent-ink-3 sm:inline">
            {agentName
              ? tShell("liveQueueSubtitleWithName", { name: agentName })
              : tShell("liveQueueSubtitle")}
          </span>
        </div>

        <div className="ms-auto flex items-center gap-3">
          <div className="hidden items-center md:flex">
            <MeterCell
              label={t("stats.confirmationRate")}
              value={`${stats.confirmation_rate.toFixed(1)}%`}
            />
            <MeterCell label={t("stats.actioned")} value={String(stats.actioned_count)} />
            <MeterCell label={t("stats.assigned")} value={String(stats.assigned_count)} />
          </div>

          {onNewOrder && (
            <button
              type="button"
              onClick={onNewOrder}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-pill bg-agent-primary px-4 text-[13.5px] font-bold text-agent-on-primary transition-colors duration-base hover:bg-agent-on-primary-container"
            >
              <Plus size={15} strokeWidth={2.5} aria-hidden="true" />
              <span>{tShell("newOrder")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Level 1 — buckets. */}
      <div
        role="tablist"
        aria-label={t("title")}
        className="flex items-end border-b border-agent-outline-variant"
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

      {/* Level 2 — sub-filters, in one permanent place whichever bucket is open.
          They used to render inline for en_cours and as a second row for
          fermées, so their position moved as you navigated. */}
      {showSubfilters && (
        <div
          role="group"
          aria-label={tShell("filterLabel")}
          className="custom-scrollbar mt-2.5 flex items-center gap-2 overflow-x-auto rounded-xl border border-agent-outline-variant bg-agent-surface-low px-3.5 py-2"
        >
          <span className="flex shrink-0 items-center self-stretch border-e border-agent-outline pe-2.5 text-[10px] font-bold tracking-[0.09em] text-agent-ink-3">
            {tShell("filterLabel")}
          </span>

          {selectedBucket === "en_cours" && (
            <div className="flex flex-nowrap items-center gap-1.5">
              <FilterChip
                active={enCoursSubfilter === "all"}
                count={enCoursTotal}
                label={tEnCours("all")}
                status={null}
                onClick={() => onEnCoursSubfilterChange("all")}
              />
              <FilterChip
                active={enCoursSubfilter === "rappel"}
                count={counts.rappel_prevu}
                label={tEnCours("rappel")}
                status="callback_scheduled"
                onClick={() => onEnCoursSubfilterChange("rappel")}
              />

              <div className="relative inline-block">
                <FilterChip
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
                  label={
                    tentativeSubfilter === "all"
                      ? tEnCours("tentative")
                      : `${tEnCours("tentative")} · ${tentativeBadge}`
                  }
                  status="attempt_1"
                  ariaHaspopup
                  ariaExpanded={tentativePopoverOpen}
                  onClick={handleTentativeChipClick}
                  trailing={
                    <ChevronDown
                      size={12}
                      strokeWidth={2.25}
                      aria-hidden="true"
                      className={[
                        "ms-0.5 opacity-60 transition-transform duration-base",
                        tentativePopoverOpen ? "rotate-180" : "",
                      ].join(" ")}
                    />
                  }
                />

                {tentativePopoverOpen && (
                  <div
                    ref={popoverRef}
                    role="menu"
                    aria-label={tEnCours("tentative")}
                    className="absolute start-0 z-20 mt-1.5 min-w-[168px] rounded-xl border border-agent-outline-variant bg-agent-surface py-1 shadow-floating"
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
                      label={t3Label}
                      onClick={() => handleTentativeOptionClick(3)}
                    />
                  </div>
                )}
              </div>

              <FilterChip
                active={enCoursSubfilter === "livraison"}
                count={counts.livraison_planifiee}
                label={tEnCours("livraison")}
                status="dispatch_scheduled"
                onClick={() => onEnCoursSubfilterChange("livraison")}
              />
            </div>
          )}

          {selectedBucket === "fermees" && (
            <>
              <div className="flex flex-nowrap items-center gap-1.5">
                <FilterChip
                  active={closedSubfilter === "all"}
                  count={closedCounts.all}
                  label={tClosed("all")}
                  status={null}
                  onClick={() => onClosedSubfilterChange("all")}
                />
                {(
                  [
                    "uploaded",
                    "deposit",
                    "delivered",
                    "returned",
                    "cancelled",
                    "rejected",
                  ] as const
                ).map((key) => (
                  <FilterChip
                    key={key}
                    active={closedSubfilter === key}
                    count={closedCounts[key]}
                    label={tClosed(key)}
                    // Lifecycle bucket names are themselves keys in the shared
                    // presentation map, so the chip inherits the pill's face.
                    status={key}
                    onClick={() => onClosedSubfilterChange(key)}
                  />
                ))}
              </div>

              {onRefreshDexpress && (
                <button
                  type="button"
                  onClick={onRefreshDexpress}
                  disabled={refreshingDexpress}
                  aria-label={t("fermeesRefresh.button")}
                  title={t("fermeesRefresh.button")}
                  className="ms-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-agent-outline-variant bg-agent-surface px-2.5 text-[11.5px] font-semibold text-agent-ink-3 transition-colors duration-fast hover:border-agent-outline hover:text-agent-on-surface disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw
                    size={12}
                    strokeWidth={2.25}
                    aria-hidden="true"
                    className={refreshingDexpress ? "animate-spin" : ""}
                  />
                  <span className="hidden sm:inline">
                    {refreshingDexpress
                      ? t("fermeesRefresh.syncing")
                      : t("fermeesRefresh.button")}
                  </span>
                </button>
              )}
            </>
          )}
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
        "flex w-full items-center justify-between gap-3 px-3 py-2",
        "text-start text-[12px] font-semibold transition-colors duration-fast",
        active
          ? "bg-hue-amber-bg text-hue-amber-ink"
          : "text-agent-on-surface-variant hover:bg-agent-surface-low hover:text-agent-on-surface",
      ].join(" ")}
    >
      <span>{label}</span>
      <span className="tabular-nums text-[11px] text-agent-ink-3">{count}</span>
    </button>
  );
}

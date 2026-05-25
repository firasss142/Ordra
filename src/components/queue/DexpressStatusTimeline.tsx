"use client";

import { useEffect, useRef, useState } from "react";
import {
  Package,
  Building2,
  UserCheck,
  Truck,
  CheckCircle2,
  Undo2,
  AlertCircle,
  User,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";
import {
  findStatusBySlug,
  type DexpressSlug,
} from "@/lib/carriers/dexpress/statuses";
import {
  buildTimeline,
  colorForSlug,
  type TimelineNode,
} from "@/lib/carriers/dexpress/pipeline";
import type { Role } from "@/types";

const ICONS: Record<DexpressSlug, LucideIcon> = {
  BEING_PREPARED: Package,
  IN_COMPANY: Building2,
  WILL_BE_SENT_TO_BRANCHES: Building2,
  EN_ROUTE_TO_BRANCHES: Building2,
  ARRIVED_AT_BRANCHES: Building2,
  SENT_TO_COURIER: UserCheck,
  AWAITING_COURIER_SETTLEMENT: UserCheck,
  OUT_FOR_DELIVERY: Truck,
  DELIVERED: CheckCircle2,
  AT_CUSTOMER: User,
  DELIVERY_POSTPONED: AlertCircle,
  POSTPONED_WITH_COURIER: AlertCircle,
  RECEIPT_REFUSED: AlertCircle,
  PARTIALLY_DELIVERED: AlertCircle,
  REPLACED: AlertCircle,
  RETURNING_VIA_COURIER: Undo2,
  RETURNING_AT_BRANCHES: Undo2,
  RETURNING_TO_COMPANY: Undo2,
  RETURNED_AT_COMPANY: Undo2,
};

interface DexpressStatusTimelineProps {
  currentSlug: DexpressSlug | null;
  /** Arabic label to render under the current node. Always shown for current. */
  currentLabel: string;
  /** Viewer role — managers + admins see the SLUG next to Arabic labels. */
  role?: Role;
}

const SHOWS_SLUG: ReadonlySet<Role> = new Set<Role>([
  "market_manager",
  "super_admin",
]);

export function DexpressStatusTimeline({
  currentSlug,
  currentLabel,
  role,
}: DexpressStatusTimelineProps) {
  const nodes = buildTimeline(currentSlug);
  const showsSlug = role !== undefined && SHOWS_SLUG.has(role);

  if (nodes.length === 0) return null;

  return (
    <div
      role="list"
      aria-label="Dexpress timeline"
      className="flex items-start justify-between gap-1 w-full pt-1 pb-2"
    >
      {nodes.map((node, i) => {
        const nextNode = nodes[i + 1];
        return (
          <Node
            key={node.slug}
            node={node}
            nextNode={nextNode}
            currentLabel={node.state === "current" ? currentLabel : null}
            isLast={i === nodes.length - 1}
            showsSlug={showsSlug}
          />
        );
      })}
    </div>
  );
}

interface NodeProps {
  node: TimelineNode;
  nextNode: TimelineNode | undefined;
  currentLabel: string | null;
  isLast: boolean;
  showsSlug: boolean;
}

// Past = filled muted gray ("done, validated, turned off").
// Future = outlined gray ("hasn't happened yet").
// Current = filled with the per-slug story color, applied inline.
const PAST_RING = "border-line bg-line text-ink-secondary";
const FUTURE_RING = "border-line-strong bg-surface-card text-ink-muted";

// Past + future connector classes. The current→nextSlug connector inherits
// the rules below.
const PAST_CONNECTOR = "border-line";
const FUTURE_CONNECTOR = "border-line-strong border-dashed";

function Node({
  node,
  nextNode,
  currentLabel,
  isLast,
  showsSlug,
}: NodeProps) {
  const Icon = ICONS[node.slug] ?? HelpCircle;

  // The current node carries the story color — applied inline because each
  // slug has its own hex. Past/future use Tailwind utilities.
  const isCurrent = node.state === "current";
  const currentColor = isCurrent ? colorForSlug(node.slug) : null;

  const iconRing =
    node.state === "past"
      ? PAST_RING
      : node.state === "future"
        ? FUTURE_RING
        : ""; // current node uses inline style below, no Tailwind ring needed

  const currentInlineStyle: React.CSSProperties | undefined = currentColor
    ? {
        backgroundColor: currentColor,
        borderColor: currentColor,
        color: "white",
        // soft halo ring around the current node — same color, 20% alpha
        boxShadow: `0 0 0 3px ${currentColor}33`,
      }
    : undefined;

  // Connectors describe SEGMENTS — was the segment crossed by the order?
  //   - past↔past or past↔current → crossed → solid neutral gray (matches past)
  //   - current↔future or future↔future → uncrossed → dashed neutral gray
  //   - the segment leading INTO a branch node → tinted in the branch's color
  //     so the divergence point is visually obvious
  let connectorClass: string;
  let connectorInlineStyle: React.CSSProperties | undefined;

  if (!nextNode) {
    connectorClass = "";
  } else if (nextNode.branch) {
    // Off-path divergence — paint solid with the branch's own slug color.
    connectorClass = "";
    connectorInlineStyle = { borderColor: colorForSlug(nextNode.slug) };
  } else if (
    (node.state === "past" || node.state === "current") &&
    (nextNode.state === "past" || nextNode.state === "current")
  ) {
    connectorClass = PAST_CONNECTOR;
  } else {
    connectorClass = FUTURE_CONNECTOR;
  }

  // Tooltip text: Arabic timeline label for past/future. Managers see the slug
  // appended so a hover instantly reveals the SCREAMING_SNAKE identifier.
  const taxonomyEntry =
    node.state !== "current" ? findStatusBySlug(node.slug) : null;
  const tooltipLabel = taxonomyEntry
    ? showsSlug
      ? `${node.slug} — ${taxonomyEntry.timelineLabel}`
      : taxonomyEntry.timelineLabel
    : null;

  return (
    <div role="listitem" className="flex items-start flex-1 min-w-0">
      <div className="flex flex-col items-center flex-shrink-0 min-w-0">
        {tooltipLabel ? (
          <NodeIconWithTooltip
            label={tooltipLabel}
            iconRing={iconRing}
            inlineStyle={currentInlineStyle}
            isBranch={node.branch}
            slug={node.slug}
            state={node.state}
            Icon={Icon}
          />
        ) : (
          <NodeIconBare
            iconRing={iconRing}
            inlineStyle={currentInlineStyle}
            isBranch={node.branch}
            slug={node.slug}
            state={node.state}
            Icon={Icon}
          />
        )}

        {currentLabel && (
          <CurrentLabel
            slug={node.slug}
            arabic={currentLabel}
            showsSlug={showsSlug}
          />
        )}
      </div>

      {!isLast && (
        <div
          className={[
            "flex-1 mt-[13px] border-t-2 min-w-[12px]",
            connectorClass,
          ].join(" ")}
          style={connectorInlineStyle}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

function CurrentLabel({
  slug,
  arabic,
  showsSlug,
}: {
  slug: DexpressSlug;
  arabic: string;
  showsSlug: boolean;
}) {
  if (!showsSlug) {
    return (
      <span
        dir="rtl"
        lang="ar"
        className="mt-1.5 text-[11px] font-medium text-ink-primary text-center max-w-[10rem] leading-tight"
      >
        {arabic}
      </span>
    );
  }

  // Manager / super_admin: SLUG above + Arabic below, both centered.
  return (
    <div className="mt-1.5 flex flex-col items-center max-w-[10rem]">
      <span className="font-mono text-[10px] text-ink-secondary tabular-nums leading-tight">
        {slug}
      </span>
      <span
        dir="rtl"
        lang="ar"
        className="text-[11px] font-medium text-ink-primary text-center leading-tight"
      >
        {arabic}
      </span>
    </div>
  );
}

// ─── Icon rendering: bare (current) vs with tooltip (past/future) ───────────

interface IconRingProps {
  iconRing: string;
  inlineStyle?: React.CSSProperties;
  isBranch: boolean;
  slug: DexpressSlug;
  state: TimelineNode["state"];
  Icon: LucideIcon;
}

function NodeIconBare({
  iconRing,
  inlineStyle,
  isBranch,
  slug,
  state,
  Icon,
}: IconRingProps) {
  return (
    <div
      className={[
        "flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
        iconRing,
        isBranch ? "ring-status-warning/30 ring-2" : "",
      ].join(" ")}
      style={inlineStyle}
      data-state={state}
      data-slug={slug}
      data-branch={isBranch || undefined}
    >
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
    </div>
  );
}

function NodeIconWithTooltip({
  label,
  iconRing,
  inlineStyle,
  isBranch,
  slug,
  state,
  Icon,
}: IconRingProps & { label: string }) {
  // Tap support: track "pinned" state. Hover/focus already work via CSS.
  // Tap toggles; tapping elsewhere or pressing Esc dismisses.
  const [pinned, setPinned] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pinned) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setPinned(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPinned(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <div ref={wrapperRef} className="relative group">
      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        aria-label={label}
        aria-expanded={pinned}
        className={[
          "flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary/40",
          iconRing,
          isBranch ? "ring-status-warning/30 ring-2" : "",
        ].join(" ")}
        style={inlineStyle}
        data-state={state}
        data-slug={slug}
        data-branch={isBranch || undefined}
      >
        <Icon size={14} strokeWidth={2} aria-hidden="true" />
      </button>

      {/*
        Tooltip:
          - Hover OR keyboard focus (focus-within on the wrapper): pure CSS via Tailwind group/group-focus-within.
          - Tap: `pinned` boolean toggled by click handler above.
        Position is centered below the icon. dir="rtl" + lang="ar" so screen readers
        announce Arabic correctly even inside an LTR fallback locale.
      */}
      <div
        role="tooltip"
        dir="rtl"
        lang="ar"
        className={[
          "pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 -translate-x-1/2",
          "whitespace-nowrap rounded-md bg-ink-primary px-2 py-1 text-[11px] font-medium text-white shadow-sm",
          "transition-opacity duration-fast",
          pinned
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        ].join(" ")}
      >
        {label}
      </div>
    </div>
  );
}

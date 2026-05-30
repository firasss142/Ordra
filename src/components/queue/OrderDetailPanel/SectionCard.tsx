"use client";

import { type ComponentType, type ReactNode } from "react";
import type { LucideProps } from "lucide-react";

export interface SectionCardProps {
  title: string;
  icon: ComponentType<LucideProps>;
  /** Optional badge/affordance rendered at the end of the label row. */
  trailing?: ReactNode;
  /**
   * When provided, the whole label row becomes a button that toggles open
   * state. The trailing chevron rotates 180° when `open` is true.
   */
  collapsible?: {
    open: boolean;
    onToggle: () => void;
    /** Forwarded to the toggle button for testing. */
    testId?: string;
  };
  /** Optional extra class on the outer section. */
  className?: string;
  children: ReactNode;
}

/**
 * Pure white card with a tiny uppercase label + lucide icon header.
 * Replaces the previous tinted SECTION_ACCENT variants (client/order/note/
 * fulfillment) — section identity now comes from icon + label, not color.
 * Follows docs/design-system.md §4.10.
 */
export function SectionCard({
  title,
  icon: Icon,
  trailing,
  collapsible,
  className = "",
  children,
}: SectionCardProps) {
  const labelRow = (
    <>
      <Icon
        size={12}
        strokeWidth={2}
        aria-hidden="true"
        className="text-ink-muted flex-shrink-0"
      />
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
        {title}
      </span>
      {trailing ? <span className="ms-auto flex items-center gap-2">{trailing}</span> : null}
      {collapsible ? (
        <ChevronDown open={collapsible.open} forceMsAuto={!trailing} />
      ) : null}
    </>
  );

  return (
    <section
      className={[
        "rounded-card bg-surface-card border border-line-subtle",
        className,
      ].join(" ")}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={collapsible.onToggle}
          aria-expanded={collapsible.open}
          data-testid={collapsible.testId}
          className="flex w-full items-center gap-1.5 px-4 pt-3 pb-2 text-start"
        >
          {labelRow}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 px-4 pt-3 pb-2">{labelRow}</div>
      )}
      <div className="px-4 pb-3">{children}</div>
    </section>
  );
}

function ChevronDown({ open, forceMsAuto }: { open: boolean; forceMsAuto: boolean }) {
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={[
        "flex-shrink-0 text-ink-muted transition-transform duration-fast",
        forceMsAuto ? "ms-auto" : "",
        open ? "rotate-180" : "",
      ].join(" ")}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

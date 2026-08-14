"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, X, UserPlus, XCircle, Truck, RotateCcw } from "lucide-react";

/**
 * Bulk bar: a compact pill centred at the bottom of the viewport.
 *
 * It briefly spanned the full width of the table card. Two things were wrong
 * with that. A bar as wide as the page reads as a section of the layout rather
 * than as a response to what you just did, and in the document flow it sat
 * below the fold on a full page of 25 orders — ticking a row near the top
 * appeared to do nothing at all.
 *
 * Centred, content-width and fixed, it is in the same place whatever the table
 * is doing, covers almost nothing, and can animate in and out. It stays mounted
 * while hidden so the exit is a transition rather than a disappearance; the
 * count it shows is held over during that exit so it does not flash "0
 * sélectionnée(s)" on the way out.
 */

interface Agent {
  id: string;
  full_name: string;
}

interface Props {
  selectedIds: string[];
  agents: Agent[];
  onClearSelection: () => void;
  onBulkAssign: (agentId: string) => Promise<void> | void;
  onBulkCancel: () => Promise<void> | void;
  /** Opens the bulk upload-to-carrier panel (parent owns the panel state). */
  onUpload: () => void;
  /** Opens the bulk reopen panel for uploaded orders (parent owns the state). */
  onReopen: () => void;
  canAssign: boolean;
  canCancel: boolean;
  canUpload: boolean;
  canReopen: boolean;
  cancelDisabled?: boolean;
  cancelDisabledReason?: string;
}

export function OrdersBulkBar({
  selectedIds,
  agents,
  onClearSelection,
  onBulkAssign,
  onBulkCancel,
  onUpload,
  onReopen,
  canAssign,
  canCancel,
  canUpload,
  canReopen,
  cancelDisabled = false,
  cancelDisabledReason,
}: Props) {
  const t = useTranslations("orders.bulk");
  const [assignOpen, setAssignOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuWrapRef = useRef<HTMLDivElement>(null);

  // Close the assign menu on Escape or outside click
  useEffect(() => {
    if (!assignOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAssignOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setAssignOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [assignOpen]);

  // Re-close menu after a bulk action runs
  useEffect(() => {
    if (busy) setAssignOpen(false);
  }, [busy]);

  const shown = selectedIds.length > 0;

  /**
   * The last non-zero selection size, held through the exit animation.
   *
   * The bar stays mounted while it fades out, and by then `selectedIds` is
   * already empty — reading it directly would flash "0 sélectionnée(s)" for the
   * length of the transition, which looks like a bug rather than a dismissal.
   */
  const [heldCount, setHeldCount] = useState(selectedIds.length);
  useEffect(() => {
    if (selectedIds.length > 0) setHeldCount(selectedIds.length);
  }, [selectedIds.length]);
  const count = shown ? selectedIds.length : heldCount;

  // A menu left open on a bar that is fading out would hang in mid-air.
  useEffect(() => {
    if (!shown) setAssignOpen(false);
  }, [shown]);

  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  /**
   * Ghost buttons on a dark ground: the bar itself is the affordance, so each
   * action carries weight only under the cursor. White at 88% rather than pure
   * white — full white on this fill vibrates against the green end.
   */
  const btn =
    "inline-flex h-[34px] items-center gap-2 rounded-[10px] border border-transparent bg-transparent px-3 text-[13px] font-medium text-white/[0.88] transition-colors duration-fast hover:bg-white/[0.12] hover:text-white disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div
      role="toolbar"
      aria-label={t("selected", { count })}
      aria-hidden={!shown}
      data-visible={shown ? "true" : "false"}
      className="fixed bottom-6 left-1/2 z-40 flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-1 rounded-[16px] px-4 py-2.5"
      style={{
        /**
         * DELIBERATE EXCEPTION to the "zero gradients" rule in CLAUDE.md and
         * docs/design-system.md — requested for this bar specifically. Do not
         * "correct" it back to a flat fill without asking.
         *
         * Black at the start, brand green at the end. The dark end sits under
         * the selection count so the number reads first; the green end sits
         * under the actions, tying them to the brand colour the page's CTA and
         * active tiles already use.
         */
        backgroundImage:
          "linear-gradient(107deg, #07100C 0%, #0C1C14 34%, #124A29 68%, #15803D 100%)",
        boxShadow:
          "0 10px 30px -10px rgba(8,12,10,0.55), 0 2px 8px -2px rgba(8,12,10,0.28), inset 0 1px 0 rgba(255,255,255,0.09)",
        /**
         * Centring and the entrance are the same transform, so they compose
         * here rather than fighting over `transform` in two class layers.
         *
         * `visibility` is transitioned with a delay instead of being toggled
         * outright: at 0s it would cut the fade off, and left permanently
         * visible the hidden bar would still take focus on Tab.
         */
        transform: `translateX(-50%) translateY(${shown ? "0" : "14px"}) scale(${shown ? 1 : 0.98})`,
        opacity: shown ? 1 : 0,
        visibility: shown ? "visible" : "hidden",
        pointerEvents: shown ? "auto" : "none",
        transition: [
          "opacity 180ms ease-out",
          // Slight overshoot on the way in; it reads as the bar arriving
          // rather than as a panel being switched on.
          "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
          `visibility 0s linear ${shown ? "0ms" : "220ms"}`,
        ].join(", "),
      }}
    >
      {/* Selection count. A lit dot rather than a filled chip — the count is
          the loudest thing here and does not need a second container. */}
      <span className="inline-flex items-center gap-2.5 whitespace-nowrap pe-3 text-[14px] font-semibold tabular-nums text-white">
        <span
          aria-hidden
          className="block h-2.5 w-2.5 flex-none rounded-full bg-[#4ADE80] shadow-[0_0_0_3px_rgba(74,222,128,0.22)]"
        />
        {t("selected", { count })}
      </span>
      <span aria-hidden className="mx-2 block h-6 w-px bg-white/20" />

      {/* Assign menu */}
      {canAssign && (
        <div ref={menuWrapRef} className="relative">
          <button
            type="button"
            onClick={() => setAssignOpen((o) => !o)}
            disabled={busy}
            aria-haspopup="listbox"
            aria-expanded={assignOpen}
            className={btn}
          >
            <UserPlus size={14} strokeWidth={2} aria-hidden="true" />
            {t("assign")}
            <ChevronDown
              size={13}
              strokeWidth={2}
              aria-hidden="true"
              className={`transition-transform duration-fast ${assignOpen ? "rotate-180" : ""}`}
            />
          </button>

          {/* Opens UPWARD: the bar sits at the bottom of the viewport, so a
              menu hanging below it would be off-screen.

              Dark to match the bar it hangs off — a white popover here read as
              a piece of the page that had drifted on top of the toolbar. */}
          {assignOpen && (
            <div
              role="listbox"
              className="absolute bottom-[calc(100%+10px)] start-0 z-30 max-h-80 min-w-[224px] overflow-y-auto rounded-[13px] border border-white/10 bg-[#0B1310] p-1.5 shadow-[0_-10px_34px_-10px_rgba(6,10,8,0.7)] animate-[fadeInUp_140ms_ease-out]"
            >
              {agents.length === 0 ? (
                <div className="px-3 py-2 text-[13px] text-white/55">{t("noAgents")}</div>
              ) : (
                agents.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => {
                      setAssignOpen(false);
                      void run(() => onBulkAssign(a.id));
                    }}
                    className="block w-full rounded-[9px] px-2.5 py-2 text-start text-[13px] font-medium text-white/[0.88] transition-colors duration-fast hover:bg-white/[0.12] hover:text-white focus-visible:bg-white/[0.12]"
                  >
                    {a.full_name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Upload selected to a carrier/account */}
      {canUpload && (
        <button type="button" onClick={onUpload} disabled={busy} className={btn}>
          <Truck size={14} strokeWidth={2} aria-hidden="true" />
          {t("upload")}
        </button>
      )}

      {/* Reopen uploaded selected (void shipment + back to confirmed) */}
      {canReopen && (
        <button type="button" onClick={onReopen} disabled={busy} className={btn}>
          <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
          {t("reopen")}
        </button>
      )}

      {/* Cancel selected. The one action here that destroys something, so it
          stays visibly apart from the ghosts. `--status-critical` is tuned for
          white grounds and goes muddy on this fill, so it takes the lighter red
          that actually reads against a dark surface. */}
      {canCancel && (
        <button
          type="button"
          onClick={() => void run(onBulkCancel)}
          disabled={busy || cancelDisabled}
          title={cancelDisabled ? cancelDisabledReason : undefined}
          className="inline-flex h-[34px] items-center gap-2 rounded-[10px] border border-transparent bg-transparent px-3 text-[13px] font-medium text-[#FDA29B] transition-colors duration-fast hover:bg-[#B42318]/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <XCircle size={14} strokeWidth={2} aria-hidden="true" />
          {t("cancel")}
        </button>
      )}

      {/* Clear selection */}
      <button
        type="button"
        onClick={onClearSelection}
        disabled={busy}
        aria-label={t("clearSelection")}
        title={t("clearSelection")}
        className="ms-auto grid h-[30px] w-[30px] place-items-center rounded-[9px] text-white/60 transition-colors duration-fast hover:bg-white/[0.14] hover:text-white disabled:opacity-40"
      >
        <X size={14} strokeWidth={2.3} aria-hidden="true" />
      </button>
    </div>
  );
}

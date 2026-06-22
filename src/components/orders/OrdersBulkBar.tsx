"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, X, UserPlus, XCircle, Truck, RotateCcw } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";

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
  const isMobile = useIsMobile();
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

  if (selectedIds.length === 0) return null;

  const run = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  // Container positioning — bottom-fixed; full-width on mobile, centred pill on desktop.
  // CRITICAL: dropdown opens UPWARD because the bar lives at viewport bottom — anchoring
  // to `bottom: 100% + 6px` keeps the menu on-screen on both mobile and desktop.
  const containerClass = isMobile
    ? "fixed bottom-0 inset-x-0 z-30 flex flex-wrap items-center gap-2 px-4 py-3"
    : "fixed bottom-6 start-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-card";

  return (
    <div
      role="toolbar"
      aria-label={t("selected", { count: selectedIds.length })}
      className={`${containerClass} bg-ink-primary text-white shadow-floating`}
    >
      {/* Selection count */}
      <span className="text-[13px] font-medium tabular-nums whitespace-nowrap">
        {t("selected", { count: selectedIds.length })}
      </span>

      {/* Divider */}
      <span aria-hidden="true" className="h-5 w-px bg-white/15" />

      {/* Assign menu */}
      {canAssign && (
        <div ref={menuWrapRef} className="relative">
          <button
            type="button"
            onClick={() => setAssignOpen((o) => !o)}
            disabled={busy}
            aria-haspopup="listbox"
            aria-expanded={assignOpen}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-card bg-white/10 hover:bg-white/15 active:bg-white/20 text-[13px] font-medium transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UserPlus size={13} strokeWidth={2} aria-hidden="true" />
            {t("assign")}
            <ChevronDown
              size={13}
              strokeWidth={2}
              aria-hidden="true"
              className={`transition-transform duration-fast ${assignOpen ? "rotate-180" : ""}`}
            />
          </button>

          {assignOpen && (
            <div
              role="listbox"
              className="absolute bottom-[calc(100%+8px)] start-0 min-w-[220px] max-h-80 overflow-y-auto rounded-card bg-surface-card border border-line-subtle shadow-floating p-1"
            >
              {agents.length === 0 ? (
                <div className="px-3 py-2 text-[13px] text-ink-secondary">
                  {t("noAgents")}
                </div>
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
                    className="block w-full text-start rounded-md px-2.5 py-2 text-[13px] font-medium text-ink-primary hover:bg-surface-hover focus-visible:bg-surface-hover transition-colors duration-fast"
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
        <button
          type="button"
          onClick={onUpload}
          disabled={busy}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-card bg-white/10 hover:bg-white/15 active:bg-white/20 text-[13px] font-medium transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Truck size={13} strokeWidth={2} aria-hidden="true" />
          {t("upload")}
        </button>
      )}

      {/* Reopen uploaded selected (void shipment + back to confirmed) */}
      {canReopen && (
        <button
          type="button"
          onClick={onReopen}
          disabled={busy}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-card bg-white/10 hover:bg-white/15 active:bg-white/20 text-[13px] font-medium transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
          {t("reopen")}
        </button>
      )}

      {/* Cancel selected */}
      {canCancel && (
        <button
          type="button"
          onClick={() => void run(onBulkCancel)}
          disabled={busy || cancelDisabled}
          title={cancelDisabled ? cancelDisabledReason : undefined}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-card bg-status-critical hover:bg-[#B82408] active:bg-[#A11F07] text-[13px] font-medium text-white transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <XCircle size={13} strokeWidth={2} aria-hidden="true" />
          {t("cancel")}
        </button>
      )}

      {/* Spacer pushes Clear to the end on mobile (full-width); on desktop the natural gap is enough */}
      {isMobile && <span className="flex-1" aria-hidden="true" />}

      {/* Clear selection */}
      <button
        type="button"
        onClick={onClearSelection}
        disabled={busy}
        aria-label={t("clearSelection")}
        title={t("clearSelection")}
        className="inline-flex items-center justify-center w-8 h-8 rounded-card text-white/70 hover:text-white hover:bg-white/10 transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <X size={15} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}

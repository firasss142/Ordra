"use client";

import type { ReactNode } from "react";
import FocusTrap from "focus-trap-react";
import { X, type LucideIcon } from "lucide-react";

/*
 * Escape is handled once, by the page, which closes the topmost layer only
 * (menu, then dialog, then panel). These shells only draw and trap focus.
 */

const TRAP = { allowOutsideClick: true, escapeDeactivates: false, returnFocusOnDeactivate: false } as const;

export function CloseButton({ label, onClick, className = "" }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`acx-close ${className}`.trim()}
    >
      <X size={16} aria-hidden="true" />
    </button>
  );
}

/**
 * The floating glass drawer (design-system §4.9): inset 12px, 26px radius, a
 * blurred scrim, and a halo of `tone` (the person's role hue) behind the head.
 * 480px wide so its footer holds on one line; a bottom sheet on a phone.
 */
export function SidePanel({ labelledBy, onClose, tone = "tone-all", children }: { labelledBy: string; onClose: () => void; tone?: string; children: ReactNode }) {
  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="acx-scrim" />
      <FocusTrap focusTrapOptions={{ ...TRAP, fallbackFocus: () => document.body }}>
        <aside role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={`${tone} acx-drawer`}>
          {children}
        </aside>
      </FocusTrap>
    </>
  );
}

const DIALOG_TONE = {
  critical: "bad",
  manager: "tone-manager tone",
} as const;

/** A centred decision (§4.13 modal): a tinted icon, the question, then two full-width buttons. */
export function AccessDialog({
  labelId,
  icon: Icon,
  tone,
  title,
  lead,
  closeLabel,
  onClose,
  children,
  footer,
}: {
  labelId: string;
  icon: LucideIcon;
  tone: keyof typeof DIALOG_TONE;
  title: ReactNode;
  lead?: ReactNode;
  closeLabel: string;
  onClose: () => void;
  children?: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="acx-modal-scrim"
    >
      <FocusTrap focusTrapOptions={{ ...TRAP, fallbackFocus: () => document.body }}>
        <div role="dialog" aria-modal="true" aria-labelledby={labelId} className="acx-modal">
          <div className="acx-modal-h">
            <CloseButton label={closeLabel} onClick={onClose} />
            <div className={`acx-modal-ic ${DIALOG_TONE[tone]}`}>
              <Icon size={22} aria-hidden="true" />
            </div>
            <h2 id={labelId}>{title}</h2>
            {lead && <p className="acx-modal-lead">{lead}</p>}
          </div>
          {children && <div className="acx-modal-b">{children}</div>}
          <div className="acx-modal-f">{footer}</div>
        </div>
      </FocusTrap>
    </div>
  );
}

/** A server error, read out as it appears. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="acx-formerr">
      {message}
    </p>
  );
}

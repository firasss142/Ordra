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
      className={`grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] text-[#4F555B] hover:bg-[#F3F4F6] hover:text-[#15171A] ${className}`}
    >
      <X size={16} aria-hidden="true" />
    </button>
  );
}

/** The right-edge panel (§4.13), 480px so its footer holds on one line. */
export function SidePanel({ labelledBy, onClose, children }: { labelledBy: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-[49] bg-[rgba(17,24,39,.42)]" />
      <FocusTrap focusTrapOptions={{ ...TRAP, fallbackFocus: () => document.body }}>
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          className="fixed bottom-0 end-0 top-0 z-[50] flex w-full max-w-[100vw] flex-col bg-white shadow-[0_8px_32px_rgba(16,24,40,.10)] sm:w-[480px]"
        >
          {children}
        </aside>
      </FocusTrap>
    </>
  );
}

const DIALOG_TONE = {
  critical: "bg-[#FEF0EE] text-[#DC2626]",
  manager: "tone-manager bg-tone-bg text-tone",
} as const;

/** A centred decision: a tinted icon, the question, then two full-width buttons. */
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
      className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(17,24,39,.42)] p-[16px]"
    >
      <FocusTrap focusTrapOptions={{ ...TRAP, fallbackFocus: () => document.body }}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          className="relative flex max-h-[calc(100vh-80px)] w-[440px] max-w-full flex-col rounded-[16px] bg-white shadow-[0_12px_32px_rgba(16,24,40,.14)]"
        >
          <div className="px-[24px] pt-[24px]">
            <CloseButton label={closeLabel} onClick={onClose} className="absolute end-[14px] top-[14px]" />
            <div className={`mb-[14px] grid h-[46px] w-[46px] place-items-center rounded-[13px] ${DIALOG_TONE[tone]}`}>
              <Icon size={22} aria-hidden="true" />
            </div>
            <h2 id={labelId} className="m-0 pe-[28px] text-[17px] font-bold tracking-[-.01em] text-[#15171A]">
              {title}
            </h2>
            {lead && <p className="m-0 mt-[6px] text-[13.5px] leading-[1.55] text-[#4F555B]">{lead}</p>}
          </div>
          {children && <div className="flex flex-col gap-[14px] overflow-y-auto px-[24px] pb-[2px] pt-[18px]">{children}</div>}
          <div className="grid grid-cols-2 gap-[10px] px-[24px] pb-[22px] pt-[20px]">{footer}</div>
        </div>
      </FocusTrap>
    </div>
  );
}

/** A server error, read out as it appears. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="m-0 rounded-[10px] border border-[#F5C9C4] bg-[#FDECEA] px-[12px] py-[9px] text-[13px] text-[#C0362C]">
      {message}
    </p>
  );
}

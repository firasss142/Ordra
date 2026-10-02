"use client";

import type { ReactNode } from "react";
import { RgButton } from "./RgButton";

/** A small centred question with two answers (prototype `.modal`). */
export function ConfirmDialog({
  title,
  body,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  danger = true,
}: {
  title: ReactNode;
  body: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  danger?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(17,24,39,.36)]" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="rg-confirm-title" className="w-[420px] max-w-[92vw] rounded-[12px] border border-line bg-white shadow-floating">
        <h3 id="rg-confirm-title" className="m-0 px-[20px] pb-[6px] pt-[16px] text-[16px] font-semibold text-ink-primary">
          {title}
        </h3>
        <div className="px-[20px] pb-[16px] text-[13.5px] text-ink-secondary">{body}</div>
        <div className="flex justify-end gap-[8px] rounded-b-[12px] border-t border-line-subtle bg-surface-sunken px-[20px] py-[12px]">
          <RgButton onClick={onCancel} autoFocus>
            {cancelLabel}
          </RgButton>
          <RgButton variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </RgButton>
        </div>
      </div>
    </div>
  );
}

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
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(15,23,40,.32)] backdrop-blur-[4px]" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="rg-confirm-title" className="w-[420px] max-w-[92vw] rounded-[20px] border border-[rgba(255,255,255,.9)] bg-white shadow-[0_22px_56px_rgba(20,25,60,.24)]">
        <h3 id="rg-confirm-title" className="m-0 px-[22px] pb-[6px] pt-[20px] text-[17px] font-extrabold text-[#0F1728]">
          {title}
        </h3>
        <div className="px-[22px] pb-[18px] text-[13.5px] font-medium text-[#475467]">{body}</div>
        <div className="flex justify-end gap-[8px] rounded-b-[20px] border-t border-[rgba(15,23,40,.07)] bg-[#F8F9FC] px-[20px] py-[12px]">
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

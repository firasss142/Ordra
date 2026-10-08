"use client";

import type { ReactNode } from "react";
import { RgButton } from "./RgButton";

/** A small centred question with two answers. */
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
    <div className="rg-modal-bg" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="rg-confirm-title" className="rg-modal">
        <h3 id="rg-confirm-title">{title}</h3>
        <div className="bd">{body}</div>
        <footer>
          <RgButton onClick={onCancel} autoFocus>
            {cancelLabel}
          </RgButton>
          <RgButton variant={danger ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </RgButton>
        </footer>
      </div>
    </div>
  );
}

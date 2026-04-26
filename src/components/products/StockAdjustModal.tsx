"use client";

import React, { useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import type FocusTrapType from "focus-trap-react";

const FocusTrap = dynamic(() => import("focus-trap-react"), { ssr: false }) as typeof FocusTrapType;

export interface StockAdjustState {
  productId: string;
  productName: string;
  change: string;
  reason: "manual_adjustment" | "damaged_writeoff";
  note: string;
  loading: boolean;
  error: string | null;
}

interface StockAdjustModalProps {
  state: StockAdjustState;
  onChange: (patch: Partial<StockAdjustState>) => void;
  onSubmit: () => void;
  onClose: () => void;
}

const BORDER = "#E1E3E5";

export function StockAdjustModal({ state, onChange, onSubmit, onClose }: StockAdjustModalProps) {
  const t = useTranslations("products");
  const modalRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    if (!state.loading) onClose();
  }, [state.loading, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handleClose]);

  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, backgroundColor: "rgba(26,26,26,0.4)", zIndex: 40 }}
        onClick={handleClose}
      />
      <FocusTrap focusTrapOptions={{ allowOutsideClick: true, fallbackFocus: () => modalRef.current ?? document.body }}>
        <div
          ref={modalRef}
          tabIndex={-1}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "#FFFFFF",
            border: `1px solid ${BORDER}`,
            borderRadius: "0.5rem",
            padding: 24,
            zIndex: 50,
            width: "min(400px, 95vw)",
            maxHeight: "90vh",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", marginBottom: 4 }}>
            {t("stockModal.title", { name: state.productName })}
          </div>

          <div>
            <label style={{ fontSize: 13, color: "#6D7175", display: "block", marginBottom: 4 }}>
              {t("stockModal.quantityLabel")}
            </label>
            <input
              type="number"
              value={state.change}
              onChange={(e) => onChange({ change: e.target.value })}
              placeholder={t("stockModal.quantityPlaceholder")}
              style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 4, boxSizing: "border-box" }}
            />
          </div>

          <div>
            <label style={{ fontSize: 13, color: "#6D7175", display: "block", marginBottom: 4 }}>
              {t("stockModal.reasonLabel")}
            </label>
            <select
              value={state.reason}
              onChange={(e) => onChange({ reason: e.target.value as "manual_adjustment" | "damaged_writeoff" })}
              style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 4 }}
            >
              <option value="manual_adjustment">{t("stockReasons.manual_adjustment")}</option>
              <option value="damaged_writeoff">{t("stockReasons.damaged_writeoff")}</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 13, color: "#6D7175", display: "block", marginBottom: 4 }}>
              {t("stockModal.noteLabel")}
            </label>
            <input
              type="text"
              value={state.note}
              onChange={(e) => onChange({ note: e.target.value })}
              placeholder={t("stockModal.notePlaceholder")}
              style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 4, boxSizing: "border-box" }}
            />
          </div>

          {state.error && (
            <div style={{ fontSize: 12, color: "#DC2626" }}>{state.error}</div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={handleClose}
              disabled={state.loading}
              style={{ padding: "8px 16px", fontSize: 13, border: `1px solid ${BORDER}`, borderRadius: 4, background: "white", cursor: "pointer" }}
            >
              {t("stockModal.cancel")}
            </button>
            <button
              onClick={onSubmit}
              disabled={state.loading}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                border: "none",
                borderRadius: 4,
                background: "#1A1A1A",
                color: "white",
                cursor: state.loading ? "not-allowed" : "pointer",
              }}
            >
              {state.loading ? t("stockModal.saving") : t("stockModal.apply")}
            </button>
          </div>
        </div>
      </FocusTrap>
    </>
  );
}

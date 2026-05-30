"use client";

import React, { useEffect, useState } from "react";
import FocusTrap from "focus-trap-react";
import { useTranslations } from "next-intl";
import { X, AlertTriangle } from "lucide-react";

interface Props {
  userId: string;
  userName: string;
  open: boolean;
  onClose: () => void;
  onDelete: (id: string) => Promise<{ ordersReturned: number }>;
  onSuccess: (ordersReturned: number) => void;
}

export function DeleteUserFlow({
  userId,
  userName,
  open,
  onClose,
  onDelete,
  onSuccess,
}: Props) {
  const t = useTranslations("users");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const { ordersReturned } = await onDelete(userId);
      onSuccess(ordersReturned);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200 }}
      />
      <FocusTrap>
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            background: "white",
            borderRadius: 12,
            width: 440,
            maxWidth: "90vw",
            zIndex: 201,
            boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 20px",
              borderBottom: "1px solid #E1E3E5",
            }}
          >
            <span style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
              {t("deleteConfirmTitle", { name: userName })}
            </span>
            <button
              onClick={onClose}
              aria-label="Fermer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: "1px solid #E1E3E5",
                background: "white",
                cursor: "pointer",
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ padding: 20 }}>
            <div
              style={{
                display: "flex",
                gap: 12,
                padding: "12px 14px",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 8,
                fontSize: 13,
                color: "#7F1D1D",
                marginBottom: 16,
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{t("deleteConfirmBody")}</span>
            </div>

            {error && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  borderRadius: 6,
                  fontSize: 13,
                  color: "#B91C1C",
                }}
              >
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                onClick={onClose}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  background: "white",
                  border: "1px solid #E1E3E5",
                  borderRadius: 6,
                  fontSize: 14,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {t("cancel")}
              </button>
              <button
                onClick={handleConfirm}
                disabled={loading}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  background: loading ? "#E1E3E5" : "#B91C1C",
                  color: loading ? "#9CA3AF" : "white",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? t("deleting") : t("deleteConfirm")}
              </button>
            </div>
          </div>
        </div>
      </FocusTrap>
    </>
  );
}

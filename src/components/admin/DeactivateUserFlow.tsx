"use client";

import React, { useEffect, useState } from "react";
import FocusTrap from "focus-trap-react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import type { DeactivationReason } from "@/types";

interface Props {
  userId: string;
  userName: string;
  open: boolean;
  onClose: () => void;
  onDeactivate: (id: string, reason: DeactivationReason) => Promise<{ ordersReturned: number }>;
  onSuccess: (ordersReturned: number) => void;
}

const REASONS: { value: DeactivationReason; icon: string }[] = [
  { value: "on-leave", icon: "🏖" },
  { value: "off-boarded", icon: "👋" },
  { value: "terminated", icon: "📋" },
];

export function DeactivateUserFlow({
  userId,
  userName,
  open,
  onClose,
  onDeactivate,
  onSuccess,
}: Props) {
  const t = useTranslations("users");
  const [step, setStep] = useState<1 | 2>(1);
  const [reason, setReason] = useState<DeactivationReason | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep(1);
      setReason(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  async function handleConfirm() {
    if (!reason) return;
    setLoading(true);
    setError(null);
    try {
      const { ordersReturned } = await onDeactivate(userId, reason);
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
          {/* Header */}
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
              {t("deactivateTitle", { name: userName })}
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
            {step === 1 && (
              <>
                <p style={{ fontSize: 13, color: "#6D7175", marginBottom: 16 }}>
                  {t("deactivateReasonLabel")}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {REASONS.map(({ value, icon }) => (
                    <label
                      key={value}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 14px",
                        border: `2px solid ${reason === value ? "#1A1A1A" : "#E1E3E5"}`,
                        borderRadius: 8,
                        cursor: "pointer",
                        transition: "border-color 150ms ease",
                      }}
                    >
                      <input
                        type="radio"
                        name="reason"
                        value={value}
                        checked={reason === value}
                        onChange={() => setReason(value)}
                        style={{ display: "none" }}
                      />
                      <span style={{ fontSize: 20 }}>{icon}</span>
                      <span style={{ fontSize: 14, fontWeight: reason === value ? 500 : 400, color: "#1A1A1A" }}>
                        {t(`reasons.${value}` as Parameters<typeof t>[0])}
                      </span>
                    </label>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                  <button
                    onClick={onClose}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      background: "white",
                      border: "1px solid #E1E3E5",
                      borderRadius: 6,
                      fontSize: 14,
                      cursor: "pointer",
                    }}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    onClick={() => setStep(2)}
                    disabled={!reason}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      background: reason ? "#1A1A1A" : "#E1E3E5",
                      color: reason ? "white" : "#9CA3AF",
                      border: "none",
                      borderRadius: 6,
                      fontSize: 14,
                      fontWeight: 500,
                      cursor: reason ? "pointer" : "not-allowed",
                    }}
                  >
                    Continuer
                  </button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div
                  style={{
                    padding: "12px 14px",
                    background: "#FFF7ED",
                    border: "1px solid #FED7AA",
                    borderRadius: 8,
                    fontSize: 14,
                    color: "#9A3412",
                    marginBottom: 16,
                  }}
                >
                  {t("deactivateAffectedOrders", { count: "…" })}
                </div>

                <p style={{ fontSize: 13, color: "#6D7175" }}>
                  {t("deactivateReasonLabel")} :{" "}
                  <strong>{reason ? t(`reasons.${reason}` as Parameters<typeof t>[0]) : ""}</strong>
                </p>

                {error && (
                  <div
                    style={{
                      marginTop: 12,
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

                <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                  <button
                    onClick={() => setStep(1)}
                    style={{
                      flex: 1,
                      padding: "10px 0",
                      background: "white",
                      border: "1px solid #E1E3E5",
                      borderRadius: 6,
                      fontSize: 14,
                      cursor: "pointer",
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
                    {loading ? "Désactivation…" : t("deactivateConfirm")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </FocusTrap>
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

interface Props {
  orderId: string;
  customerName: string;
  onClose: () => void;
  onEscalated: () => void;
}

const MAX_NOTE_LENGTH = 500;

export function EscalateCarrierModal({ orderId, customerName, onClose, onEscalated }: Props) {
  const t = useTranslations("inDelivery.escalate");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const disabled = note.trim().length === 0 || submitting;

  const submit = async () => {
    if (disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/escalate-carrier`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? t("genericError"));
        setSubmitting(false);
        return;
      }
      onEscalated();
    } catch {
      setError(t("genericError"));
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="escalate-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(26,26,26,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 8,
          width: 480,
          maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBlockEnd: "1px solid #E5E7EB",
          }}
        >
          <h2
            id="escalate-title"
            style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}
          >
            {t("title")}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6D7175" }}>
            {t("subtitle", { name: customerName })}
          </p>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <label
            htmlFor="escalate-note"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "#6D7175",
              marginBlockEnd: 4,
            }}
          >
            {t("noteLabel")}
          </label>
          <textarea
            id="escalate-note"
            ref={textareaRef}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE_LENGTH))}
            rows={4}
            placeholder={t("notePlaceholder")}
            style={{
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 14,
              color: "#1A1A1A",
              resize: "vertical",
              fontFamily: "inherit",
              minHeight: 96,
            }}
          />
          <div
            style={{
              fontSize: 11,
              color: "#6D7175",
              textAlign: "end",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {note.length}/{MAX_NOTE_LENGTH}
          </div>
          {error && (
            <div
              role="alert"
              style={{
                fontSize: 13,
                padding: "8px 10px",
                borderRadius: 6,
                backgroundColor: "#FFF4F4",
                color: "#D72C0D",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "12px 20px",
            borderBlockStart: "1px solid #E5E7EB",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              all: "unset",
              padding: "8px 14px",
              borderRadius: 4,
              border: "1px solid #D1D5DB",
              backgroundColor: "#FFFFFF",
              fontSize: 14,
              color: "#1A1A1A",
              cursor: "pointer",
            }}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={disabled}
            style={{
              all: "unset",
              padding: "8px 14px",
              borderRadius: 4,
              backgroundColor: disabled ? "#F3F4F6" : "#1A1A1A",
              color: disabled ? "#9CA3AF" : "#FFFFFF",
              fontSize: 14,
              fontWeight: 500,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

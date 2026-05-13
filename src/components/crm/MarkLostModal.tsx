"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { LEAD_LOST_REASONS, type LeadLostReason } from "@/types/lead";

interface Props {
  open: boolean;
  leadId: string;
  locale: string;
  onClose: () => void;
  onDone: () => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6D7175",
  display: "block",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 14,
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  background: "white",
  color: "#1A1A1A",
  outline: "none",
};

export function MarkLostModal({ open, leadId, locale, onClose, onDone }: Props) {
  const t = useTranslations("crm.leads.markLost");
  const tReasons = useTranslations("crm.leads.lostReasons");
  const [reason, setReason] = useState<LeadLostReason>("not_interested");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason("not_interested");
      setNote("");
      setErr(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  async function submit() {
    setErr(null);
    if (!reason) return setErr(t("errors.reasonRequired"));
    if (reason === "autre" && !note.trim()) return setErr(t("errors.noteRequired"));

    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_status: "lost",
          lost_reason: reason,
          lost_note: reason === "autre" ? note.trim() : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || t("errors.generic"));
        setBusy(false);
        return;
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errors.generic"));
      setBusy(false);
    }
  }

  const isRtl = locale === "ar";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(26,26,26,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        direction: isRtl ? "rtl" : "ltr",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: "92vw",
          background: "white",
          border: "1px solid #E1E3E5",
          borderRadius: 12,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#1A1A1A" }}>
          {t("title")}
        </h2>

        <div>
          <label style={labelStyle}>{t("reason")}</label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as LeadLostReason)}
            style={inputStyle}
          >
            {LEAD_LOST_REASONS.map((r) => (
              <option key={r} value={r}>
                {tReasons(r)}
              </option>
            ))}
          </select>
        </div>

        {reason === "autre" && (
          <div>
            <label style={labelStyle}>{t("note")}</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        {err && <div style={{ fontSize: 12, color: "#DC2626" }}>{err}</div>}

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: isRtl ? "flex-start" : "flex-end",
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              height: 36,
              padding: "0 16px",
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              background: "white",
              color: "#1A1A1A",
              fontSize: 14,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {locale === "ar" ? "إلغاء" : "Annuler"}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            style={{
              height: 36,
              padding: "0 16px",
              border: "1px solid #DC2626",
              borderRadius: 6,
              background: busy ? "#9CA3AF" : "#DC2626",
              color: "white",
              fontSize: 14,
              fontWeight: 500,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            {t("submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

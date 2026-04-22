"use client";

import React, { useState, useEffect } from "react";
import { useTranslations } from "next-intl";

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

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleCallbackModal({
  open,
  leadId,
  locale,
  onClose,
  onDone,
}: Props) {
  const t = useTranslations("crm.leads.callback");
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const def = new Date(Date.now() + 60 * 60 * 1000);
      setTime(toLocalInputValue(def));
      setNote("");
      setErr(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  async function submit() {
    setErr(null);
    if (!time) return setErr(t("errors.timeRequired"));
    const d = new Date(time);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now())
      return setErr(t("errors.timeFuture"));

    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_time: d.toISOString(),
          note: note.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || "Error");
        setBusy(false);
        return;
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
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
          <label style={labelStyle}>{t("callbackTime")}</label>
          <input
            type="datetime-local"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>{t("note")}</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={inputStyle}
          />
        </div>

        {err && <div style={{ fontSize: 12, color: "#DC2626" }}>{err}</div>}

        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: isRtl ? "flex-start" : "flex-end",
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
              border: "1px solid #1A1A1A",
              borderRadius: 6,
              background: busy ? "#9CA3AF" : "#1A1A1A",
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

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import { CarrierSelect, type CarrierOption } from "./CarrierSelect";

interface ScheduleDispatchModalProps {
  orderId: string;
  marketId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(26,26,26,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60,
};

const panelStyle: React.CSSProperties = {
  background: "#FFFFFF",
  borderRadius: "0.5rem",
  width: 480,
  maxWidth: "90vw",
  maxHeight: "85vh",
  overflowY: "auto",
  position: "relative",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 20px",
  borderBottom: "1px solid #E5E7EB",
};

const bodyStyle: React.CSSProperties = {
  padding: "20px",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 14,
  border: "1px solid #D1D5DB",
  borderRadius: "0.25rem",
  width: "100%",
  color: "#1A1A1A",
  backgroundColor: "#FFFFFF",
  outline: "none",
  boxSizing: "border-box",
};

const submitButtonBase: React.CSSProperties = {
  width: "100%",
  padding: "12px 16px",
  backgroundColor: "#1A1A1A",
  color: "#FFFFFF",
  border: "none",
  borderRadius: "0.25rem",
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  marginTop: 16,
};

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toLocalTimeString(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function defaultScheduledAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}

export function ScheduleDispatchModal({
  orderId,
  marketId,
  onClose,
  onSuccess,
}: ScheduleDispatchModalProps) {
  const t = useTranslations("orders.scheduleDispatch");
  const panelRef = useRef<HTMLDivElement>(null);

  const [scheduledAt, setScheduledAt] = useState<Date>(() => defaultScheduledAt());
  const [dateVal, setDateVal] = useState(toLocalDateString(scheduledAt));
  const [timeVal, setTimeVal] = useState(toLocalTimeString(scheduledAt));
  const [autoDispatch, setAutoDispatch] = useState(false);
  const [carrierId, setCarrierId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(new Date().toISOString().slice(0, 10));
  }, []);

  useEffect(() => {
    if (dateVal && timeVal) {
      const combined = new Date(`${dateVal}T${timeVal}:00`);
      if (!isNaN(combined.getTime())) setScheduledAt(combined);
    }
  }, [dateVal, timeVal]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const isFuture = scheduledAt.getTime() > Date.now();
  const canSubmit =
    isFuture && !loading && (!autoDispatch || carrierId !== null);

  async function handleSubmit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/schedule-dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_at: scheduledAt.toISOString(),
          auto_dispatch: autoDispatch,
          carrier_id: autoDispatch ? carrierId : null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.error ?? t("networkError"));
        return;
      }
      onSuccess();
    } catch {
      setError(t("networkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <FocusTrap
        focusTrapOptions={{
          allowOutsideClick: true,
          fallbackFocus: () => panelRef.current ?? document.body,
        }}
      >
        <div
          ref={panelRef}
          tabIndex={-1}
          style={panelStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={headerStyle}>
            <span style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A" }}>
              {t("title")}
            </span>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: "none",
                border: "none",
                fontSize: 14,
                color: "#6B7280",
                cursor: "pointer",
              }}
            >
              {t("cancel")}
            </button>
          </div>

          <div style={bodyStyle}>
            {error && (
              <div
                style={{
                  padding: "8px 12px",
                  marginBottom: 12,
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  borderRadius: "0.25rem",
                  fontSize: 13,
                  color: "#DC2626",
                }}
              >
                {error}
              </div>
            )}

            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>
              {t("hint")}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#6B7280",
                    marginBottom: 4,
                  }}
                >
                  {t("dateLabel")}
                </div>
                <input
                  type="date"
                  aria-label={t("dateLabel")}
                  min={today}
                  value={dateVal}
                  onChange={(e) => setDateVal(e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#6B7280",
                    marginBottom: 4,
                  }}
                >
                  {t("timeLabel")}
                </div>
                <input
                  type="time"
                  aria-label={t("timeLabel")}
                  value={timeVal}
                  onChange={(e) => setTimeVal(e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            {!isFuture && (
              <div style={{ fontSize: 12, color: "#DC2626", marginBottom: 12 }}>
                {t("mustBeFuture")}
              </div>
            )}

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "12px",
                border: "1px solid #E5E7EB",
                borderRadius: "0.25rem",
                cursor: "pointer",
                marginBottom: autoDispatch ? 16 : 0,
              }}
            >
              <input
                type="checkbox"
                checked={autoDispatch}
                onChange={(e) => {
                  setAutoDispatch(e.target.checked);
                  if (!e.target.checked) setCarrierId(null);
                }}
                style={{ marginTop: 2 }}
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A" }}>
                  {t("autoDispatchLabel")}
                </div>
                <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                  {t("autoDispatchHint")}
                </div>
              </div>
            </label>

            {autoDispatch && (
              <div>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: "#6B7280",
                    marginBottom: 8,
                  }}
                >
                  {t("pickCarrier")}
                </div>
                <CarrierSelect
                  marketId={marketId}
                  onSelect={(c: CarrierOption) => setCarrierId(c.id)}
                />
              </div>
            )}

            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              style={{
                ...submitButtonBase,
                opacity: canSubmit ? 1 : 0.5,
                cursor: canSubmit ? "pointer" : "not-allowed",
              }}
            >
              {loading ? t("saving") : t("submit")}
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { X, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AdSpendWithMetrics } from "@/lib/ad-spend/realized-metrics";
import { isPeriodLocked } from "@/lib/ad-spend/period-lock";
import type { CampaignsProduct } from "@/hooks/useAdSpendCampaigns";
import { AD_SPEND_THEME as D } from "./theme";

interface FormState {
  periodStart: string;
  periodEnd: string;
  amount: string;
  productId: string; // "" = market-wide
  note: string;
  confirmLocked: boolean;
}

interface AdSpendEntryModalProps {
  entry: AdSpendWithMetrics | null; // null = create new
  products: CampaignsProduct[];
  defaultPeriodStart: string;
  defaultPeriodEnd: string;
  onClose: () => void;
  onSave: (
    data: {
      amount: number;
      period_start: string;
      period_end: string;
      product_id: string | null;
      note: string;
    },
    confirmLockedPeriod: boolean,
    entryId?: string,
  ) => Promise<void>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#0D2224",
  border: "1px solid #1E2C31",
  borderRadius: 6,
  color: "#FFFFFF",
  fontSize: 13,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#A1A1AA",
  display: "block",
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

export function AdSpendEntryModal({
  entry,
  products,
  defaultPeriodStart,
  defaultPeriodEnd,
  onClose,
  onSave,
}: AdSpendEntryModalProps) {
  const t = useTranslations("adSpend.modal");
  const [form, setForm] = useState<FormState>({
    periodStart: entry?.period_start ?? defaultPeriodStart,
    periodEnd: entry?.period_end ?? defaultPeriodEnd,
    amount: entry ? String(entry.amount) : "",
    productId: entry?.product_id ?? "",
    note: entry?.note ?? "",
    confirmLocked: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when entry changes
  useEffect(() => {
    setForm({
      periodStart: entry?.period_start ?? defaultPeriodStart,
      periodEnd: entry?.period_end ?? defaultPeriodEnd,
      amount: entry ? String(entry.amount) : "",
      productId: entry?.product_id ?? "",
      note: entry?.note ?? "",
      confirmLocked: false,
    });
    setError(null);
  }, [entry, defaultPeriodStart, defaultPeriodEnd]);

  const locked = entry ? isPeriodLocked(entry.period_end) : false;
  const submitDisabled = submitting || (locked && !form.confirmLocked);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      setError(t("errorAmount"));
      return;
    }
    if (!form.periodStart || !form.periodEnd) {
      setError(t("errorPeriod"));
      return;
    }
    if (form.periodStart > form.periodEnd) {
      setError(t("errorPeriodOrder"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSave(
        {
          amount,
          period_start: form.periodStart,
          period_end: form.periodEnd,
          product_id: form.productId || null,
          note: form.note,
        },
        form.confirmLocked,
        entry?.id,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: D.cardBg,
          border: `1px solid ${D.border}`,
          borderRadius: 12,
          width: 480,
          maxWidth: "100%",
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: `1px solid ${D.border}`,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: D.white }}>
            {entry ? t("titleEdit") : t("titleNew")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: D.muted,
              cursor: "pointer",
              padding: 4,
              lineHeight: 0,
            }}
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Period */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <span style={labelStyle}>{t("fieldStart")}</span>
              <input
                type="date"
                value={form.periodStart}
                onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))}
                style={inputStyle}
                required
              />
            </label>
            <label>
              <span style={labelStyle}>{t("fieldEnd")}</span>
              <input
                type="date"
                value={form.periodEnd}
                onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))}
                style={inputStyle}
                required
              />
            </label>
          </div>

          {/* Amount */}
          <label>
            <span style={labelStyle}>{t("fieldAmount")}</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              style={inputStyle}
              required
            />
          </label>

          {/* Product */}
          <label>
            <span style={labelStyle}>{t("fieldProduct")}</span>
            <select
              value={form.productId}
              onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              <option value="">{t("productMarketWide")}</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          {/* Note */}
          <label>
            <span style={labelStyle}>{t("fieldNote")}</span>
            <input
              type="text"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder={t("notePlaceholder")}
              style={inputStyle}
            />
          </label>

          {/* Locked-period confirmation */}
          {locked && (
            <div
              style={{
                background: "rgba(245,197,99,0.06)",
                border: "1px solid rgba(245,197,99,0.25)",
                borderRadius: 8,
                padding: "12px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Lock size={14} strokeWidth={1.5} color={D.warning} />
                <span style={{ fontSize: 13, fontWeight: 600, color: D.warning }}>
                  {t("lockedWarning")}
                </span>
              </div>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: D.muted,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={form.confirmLocked}
                  onChange={(e) => setForm((f) => ({ ...f, confirmLocked: e.target.checked }))}
                  style={{ width: 14, height: 14 }}
                />
                {t("lockedConfirm")}
              </label>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ fontSize: 13, color: D.danger }}>{error}</div>
          )}

          {/* Footer buttons */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 500,
                background: "transparent",
                border: `1px solid ${D.border}`,
                borderRadius: 6,
                color: D.muted,
                cursor: "pointer",
              }}
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              style={{
                padding: "9px 18px",
                fontSize: 13,
                fontWeight: 600,
                background: submitDisabled ? "rgba(255,255,255,0.1)" : D.white,
                border: "none",
                borderRadius: 6,
                color: submitDisabled ? D.tertiary : "#000000",
                cursor: submitDisabled ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "…" : t("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

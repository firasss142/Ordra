"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { CustomerPhoneSearch } from "./CustomerPhoneSearch";
import type { CustomerSearchResult, FollowUpStatus } from "@/types/follow-up";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (followUpId: string) => void;
  marketId?: string | null;
  marketCode?: "TN" | "LY";
  /** Pre-set follow-up status from the per-column "+" button. */
  initialStatus?: FollowUpStatus;
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

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: 72,
  padding: "8px 10px",
  resize: "vertical",
};

export function NewFollowUpModal({
  open,
  onClose,
  onCreated,
  marketId,
  marketCode,
  initialStatus,
}: Props) {
  const t = useTranslations("crm.followUps");
  const tOrderStatuses = useTranslations("orders.statuses");
  const [picked, setPicked] = useState<CustomerSearchResult | null>(null);
  const [deliveryManPhone, setDeliveryManPhone] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setPicked(null);
    setDeliveryManPhone("");
    setDescription("");
    setErr(null);
  };

  const submit = async () => {
    if (!picked) {
      setErr(t("errors.noOrderSelected"));
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/follow-ups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: picked.order_id,
          delivery_man_phone: deliveryManPhone || undefined,
          description: description || undefined,
          ...(initialStatus ? { initial_status: initialStatus } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error ?? t("errors.generic"));
      }
      onCreated?.(json?.data?.followUpId ?? json?.data?.follow_up_id ?? "");
      reset();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: 520,
          maxWidth: "92vw",
          maxHeight: "92vh",
          overflowY: "auto",
          background: "white",
          borderRadius: 8,
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, color: "#1A1A1A" }}>
            {t("newFollowUp")}
          </h2>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 18,
              cursor: "pointer",
              color: "#6B7280",
            }}
            aria-label={t("close")}
          >
            ×
          </button>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>{t("selectCustomer")}</label>
          {picked ? (
            <div
              style={{
                border: "1px solid #D1D5DB",
                borderRadius: 6,
                padding: 10,
                background: "#F9FAFB",
                fontSize: 13,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong style={{ color: "#1A1A1A" }}>{picked.customer_name}</strong>
                <button
                  type="button"
                  onClick={() => setPicked(null)}
                  style={{
                    background: "transparent",
                    border: "none",
                    fontSize: 12,
                    cursor: "pointer",
                    color: "#3B82F6",
                  }}
                >
                  {t("change")}
                </button>
              </div>
              <div style={{ color: "#6B7280", marginTop: 4 }}>
                {picked.customer_phone}
                {picked.customer_city ? ` · ${picked.customer_city}` : ""}
                {" · "}
                {tOrderStatuses(picked.status)}
              </div>
            </div>
          ) : (
            <CustomerPhoneSearch
              marketId={marketId}
              marketCode={marketCode}
              onPick={setPicked}
            />
          )}
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>{t("deliveryManPhone")}</label>
          <input
            type="tel"
            value={deliveryManPhone}
            onChange={(e) => setDeliveryManPhone(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>{t("description")}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={textareaStyle}
          />
        </div>

        {err && (
          <div
            style={{
              color: "#EF4444",
              fontSize: 13,
              marginBottom: 12,
            }}
          >
            {err}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 6,
              border: "1px solid #D1D5DB",
              background: "white",
              color: "#1A1A1A",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={submitting || !picked}
            onClick={submit}
            style={{
              height: 36,
              padding: "0 14px",
              borderRadius: 6,
              border: "none",
              background: submitting || !picked ? "#9CA3AF" : "#1A1A1A",
              color: "white",
              fontSize: 13,
              cursor: submitting || !picked ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

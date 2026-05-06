"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { CREATABLE_LEAD_SOURCES, type LeadSource, type LeadStatus } from "@/types/lead";
import { Combobox } from "@/components/ui/Combobox";
import {
  TUNISIAN_GOVERNORATES,
  LIBYAN_GOVERNORATES,
} from "@/lib/carriers/governorates";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface Product {
  id: string;
  name: string;
}

interface NewLeadModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (leadId: string) => void;
  defaultMarketId?: string | null;
  isSuperAdmin?: boolean;
  locale: string;
  /**
   * When provided via a per-column "+" button, the modal pre-fills and
   * sends this status to the API (manager/super_admin only; agents are
   * always self-assigned to "assigned").
   */
  initialStatus?: LeadStatus;
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

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function NewLeadModal({
  open,
  onClose,
  onCreated,
  defaultMarketId,
  isSuperAdmin,
  locale,
  initialStatus,
}: NewLeadModalProps) {
  const t = useTranslations("crm.leads.create");
  const tSources = useTranslations("crm.leads.sources");

  const [marketId, setMarketId] = useState(defaultMarketId ?? "");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerCity, setCustomerCity] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [source, setSource] = useState<LeadSource>("manual_call");
  const [productInterestId, setProductInterestId] = useState("");
  const [productInterestNote, setProductInterestNote] = useState("");
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const needsCallback = initialStatus === "callback_scheduled";

  const { data: marketsData } = useSWR<{ data: Market[] }>(
    open ? "/api/markets" : null,
    fetcher
  );
  const markets = marketsData?.data ?? [];

  const marketCode = useMemo(() => {
    if (marketId) {
      const found = markets.find((m) => m.id === marketId);
      if (found) return found.code;
    }
    return locale === "ar" ? "ly" : "tn";
  }, [marketId, markets, locale]);

  const cityOptions = useMemo<Array<{ id: string; label: string }>>(() => {
    if (marketCode === "tn") {
      return TUNISIAN_GOVERNORATES.map((g) => ({ id: g, label: g }));
    }
    if (marketCode === "ly") {
      return LIBYAN_GOVERNORATES.map((g) => ({
        id: g.fr,
        label: `${g.fr} — ${g.ar}`,
      }));
    }
    return [];
  }, [marketCode]);

  const productsKey =
    open && marketId ? `/api/products?market_id=${marketId}&is_active=true` : null;
  const { data: productsData } = useSWR<{ data: Product[] }>(productsKey, fetcher);
  const products = productsData?.data ?? [];

  useEffect(() => {
    if (open) {
      setMarketId(defaultMarketId ?? "");
      setCustomerName("");
      setCustomerPhone("");
      setCustomerCity("");
      setCustomerAddress("");
      setSource("manual_call");
      setProductInterestId("");
      setProductInterestNote("");
      setNotes("");
      setCallbackAt("");
      setErr(null);
      setSubmitting(false);
    }
  }, [open, defaultMarketId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!customerName.trim()) return setErr(t("errors.nameRequired"));
    if (!customerPhone.trim()) return setErr(t("errors.phoneRequired"));
    if (!source) return setErr(t("errors.sourceRequired"));

    setSubmitting(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market_id: isSuperAdmin ? marketId || null : undefined,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          customer_city: customerCity.trim() || null,
          customer_address: customerAddress.trim() || null,
          source,
          product_interest_id: productInterestId || null,
          product_interest_note: productInterestNote.trim() || null,
          notes: notes.trim() || null,
          ...(initialStatus ? { initial_status: initialStatus } : {}),
          ...(needsCallback && callbackAt ? { callback_scheduled_at: callbackAt } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error || t("errors.generic"));
        setSubmitting(false);
        return;
      }
      onCreated?.(json.data.id);
      onClose();
    } catch {
      setErr(t("errors.generic"));
      setSubmitting(false);
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
        backgroundColor: "rgba(26,26,26,0.4)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 64,
        paddingBottom: 24,
        overflowY: "auto",
        direction: isRtl ? "rtl" : "ltr",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: 520,
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
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#1A1A1A" }}>
          {t("title")}
        </h2>

        {isSuperAdmin && (
          <div>
            <label style={labelStyle}>Marché</label>
            <select
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
              style={inputStyle}
            >
              <option value="">—</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label htmlFor="new-lead-name" style={labelStyle}>{t("customerName")}</label>
            <input
              id="new-lead-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              style={inputStyle}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="new-lead-phone" style={labelStyle}>{t("customerPhone")}</label>
            <input
              id="new-lead-phone"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              style={inputStyle}
              inputMode="tel"
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("customerCity")}</label>
            {cityOptions.length > 0 ? (
              <Combobox
                value={customerCity}
                options={cityOptions}
                onCommit={(id) => setCustomerCity(id)}
                placeholder={t("cityPlaceholder")}
              />
            ) : (
              <input
                value={customerCity}
                onChange={(e) => setCustomerCity(e.target.value)}
                style={inputStyle}
              />
            )}
          </div>
          <div>
            <label style={labelStyle}>{t("source")}</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as LeadSource)}
              style={inputStyle}
            >
              {CREATABLE_LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {tSources(s)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label style={labelStyle}>{t("customerAddress")}</label>
          <input
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
            style={inputStyle}
          />
        </div>

        {needsCallback && (
          <div>
            <label htmlFor="callback-at" style={labelStyle}>
              {t("callbackScheduledAt")}
            </label>
            <input
              id="callback-at"
              type="datetime-local"
              value={callbackAt}
              onChange={(e) => setCallbackAt(e.target.value)}
              style={inputStyle}
              aria-label={t("callbackScheduledAt")}
            />
          </div>
        )}

        <div>
          <label style={labelStyle}>{t("productInterest")}</label>
          <select
            value={productInterestId}
            onChange={(e) => setProductInterestId(e.target.value)}
            style={inputStyle}
          >
            <option value="">—</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>{t("productInterestNote")}</label>
          <input
            value={productInterestNote}
            onChange={(e) => setProductInterestNote(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>{t("notes")}</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={textareaStyle}
          />
        </div>

        {err && (
          <div style={{ fontSize: 12, color: "#DC2626" }}>{err}</div>
        )}

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
            disabled={submitting}
            style={{
              height: 36,
              padding: "0 16px",
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              background: "white",
              color: "#1A1A1A",
              fontSize: 14,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {locale === "ar" ? "إلغاء" : "Annuler"}
          </button>
          <button
            type="submit"
            disabled={submitting}
            style={{
              height: 36,
              padding: "0 16px",
              border: "1px solid #1A1A1A",
              borderRadius: 6,
              background: submitting ? "#9CA3AF" : "#1A1A1A",
              color: "white",
              fontSize: 14,
              fontWeight: 500,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? t("submitting") : t("submit")}
          </button>
        </div>
      </form>
    </div>
  );
}

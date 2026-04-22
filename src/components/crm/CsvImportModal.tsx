"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { parseLeadCsv } from "@/lib/leads/csv";

interface Props {
  open: boolean;
  locale: string;
  defaultMarketId?: string | null;
  isSuperAdmin?: boolean;
  onClose: () => void;
  onImported: () => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#6D7175",
  display: "block",
  marginBottom: 4,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 180,
  padding: 10,
  fontSize: 13,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  background: "white",
  color: "#1A1A1A",
  outline: "none",
  resize: "vertical",
};

export function CsvImportModal({
  open,
  locale,
  defaultMarketId,
  isSuperAdmin,
  onClose,
  onImported,
}: Props) {
  const t = useTranslations("crm.metrics.importCsv");

  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    rows: number;
    invalid: number;
  } | null>(null);
  const [result, setResult] = useState<{
    imported: number;
    skipped: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      setCsv("");
      setErr(null);
      setPreview(null);
      setResult(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!csv.trim()) {
      setPreview(null);
      return;
    }
    const parsed = parseLeadCsv(csv);
    if (!parsed.ok) {
      setPreview(null);
      return;
    }
    const invalid = parsed.rows.filter((r) => r.error !== null).length;
    setPreview({ rows: parsed.rows.length, invalid });
  }, [csv]);

  if (!open) return null;

  async function submit() {
    setErr(null);
    setResult(null);
    if (!csv.trim()) return setErr(t("errors.empty"));

    setBusy(true);
    try {
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv,
          market_id: isSuperAdmin ? defaultMarketId ?? null : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.error === "headers") setErr(t("errors.headers"));
        else if (json.error === "empty") setErr(t("errors.empty"));
        else setErr(json.error || t("errors.generic"));
        setBusy(false);
        return;
      }
      setResult({
        imported: json.data.imported,
        skipped: json.data.skipped,
      });
      setBusy(false);
      onImported();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errors.generic"));
      setBusy(false);
    }
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file, "utf-8");
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
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 48,
        overflowY: "auto",
        direction: isRtl ? "rtl" : "ltr",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        style={{
          width: 620,
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
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#1A1A1A" }}>
            {t("title")}
          </h2>
          <div style={{ fontSize: 13, color: "#6D7175", marginTop: 4 }}>
            {t("subtitle")}
          </div>
        </div>

        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
          style={{ fontSize: 13 }}
        />

        <div>
          <label style={labelStyle}>CSV</label>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder="customer_name,customer_phone,source,customer_city,notes"
            style={textareaStyle}
          />
        </div>

        {preview && (
          <div style={{ fontSize: 13, color: "#6D7175" }}>
            {t("rowsParsed", { count: preview.rows })}
            {preview.invalid > 0 && (
              <>
                {" · "}
                <span style={{ color: "#DC2626" }}>
                  {preview.invalid} invalid
                </span>
              </>
            )}
          </div>
        )}

        {result && (
          <div
            style={{
              fontSize: 13,
              padding: 10,
              background: "#ECFDF5",
              border: "1px solid #A7F3D0",
              borderRadius: 6,
              color: "#065F46",
            }}
          >
            {t("imported", { count: result.imported })}
            {" · "}
            {t("skipped", { count: result.skipped })}
          </div>
        )}

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
            {locale === "ar" ? "إغلاق" : "Fermer"}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !csv.trim()}
            style={{
              height: 36,
              padding: "0 16px",
              border: "1px solid #1A1A1A",
              borderRadius: 6,
              background: busy || !csv.trim() ? "#9CA3AF" : "#1A1A1A",
              color: "white",
              fontSize: 14,
              fontWeight: 500,
              cursor: busy || !csv.trim() ? "not-allowed" : "pointer",
            }}
          >
            {busy ? t("submitting") : t("submit")}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useRef } from "react";
import { X, Upload, AlertTriangle, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { parseAdSpendCsv } from "@/lib/ad-spend/csv-parse";
import type { ParsedAdSpendRow } from "@/lib/ad-spend/csv-parse";
import type { CampaignsProduct } from "@/hooks/useAdSpendCampaigns";
import { AD_SPEND_THEME as D } from "./theme";

interface MappedRow extends ParsedAdSpendRow {
  product_id: string | null;
}

interface AdSpendCsvImportProps {
  products: CampaignsProduct[];
  marketId: string;
  onClose: () => void;
  onImport: (rows: MappedRow[]) => Promise<{ inserted: number; rejected: { index: number; reason: string }[] }>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#FFFFFF",
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  color: "#1A1A1A",
  fontSize: 12,
  boxSizing: "border-box",
};

export function AdSpendCsvImport({ products, onClose, onImport }: AdSpendCsvImportProps) {
  const t = useTranslations("adSpend.import");
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState<ParsedAdSpendRow[] | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({}); // campaign_name → product_id or ""
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; rejected: number } | null>(null);

  function handleParse() {
    setParseError(null);
    if (!csvText.trim()) { setParseError(t("errorEmpty")); return; }
    const { rows, source } = parseAdSpendCsv(csvText);
    if (source === "unknown") { setParseError(t("errorUnknownFormat")); return; }
    if (rows.length === 0) { setParseError(t("errorNoRows")); return; }
    setParsed(rows);
    // Pre-map: try fuzzy match campaign_name → product name
    const initial: Record<string, string> = {};
    for (const row of rows) {
      const lower = row.campaign_name.toLowerCase();
      const match = products.find((p) => lower.includes(p.name.toLowerCase()));
      initial[row.campaign_name] = match?.id ?? "";
    }
    setMappings(initial);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
      setParsed(null);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!parsed) return;
    setSubmitting(true);
    try {
      const rows: MappedRow[] = parsed.map((r) => ({
        ...r,
        product_id: mappings[r.campaign_name] || null,
      }));
      const res = await onImport(rows);
      setResult({ inserted: res.inserted, rejected: res.rejected.length });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(16,24,40,0.40)",
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
          borderRadius: 8,
          width: 640,
          maxWidth: "100%",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 24px rgba(16,24,40,0.10)",
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
            flexShrink: 0,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: D.ink }}>
            {t("title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "none", border: "none", color: D.muted, cursor: "pointer", padding: 4, lineHeight: 0 }}
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 16 }}>
          {result ? (
            /* Success state */
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 12,
                padding: "32px 0",
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  background: "rgba(54,244,164,0.12)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Check size={24} strokeWidth={2} color={D.accent} />
              </div>
              <p style={{ fontSize: 15, fontWeight: 600, color: D.ink, margin: 0 }}>
                {t("successTitle", { count: result.inserted })}
              </p>
              {result.rejected > 0 && (
                <p style={{ fontSize: 13, color: D.warning, margin: 0 }}>
                  {t("successRejected", { count: result.rejected })}
                </p>
              )}
              <button
                type="button"
                onClick={onClose}
                style={{
                  marginTop: 8,
                  padding: "9px 24px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: "#1A1A1A",
                  border: "none",
                  borderRadius: 6,
                  color: "#FFFFFF",
                  cursor: "pointer",
                }}
              >
                {t("close")}
              </button>
            </div>
          ) : !parsed ? (
            /* Input step */
            <>
              <p style={{ fontSize: 13, color: D.muted, margin: 0 }}>
                {t("description")}
              </p>
              {/* File picker */}
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFile}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "9px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    background: "transparent",
                    border: `1px solid ${D.border}`,
                    borderRadius: 6,
                    color: D.ink,
                    cursor: "pointer",
                  }}
                >
                  <Upload size={14} strokeWidth={1.5} />
                  {t("chooseFile")}
                </button>
              </div>

              <div style={{ position: "relative" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: D.tertiary, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {t("orPaste")}
                </span>
              </div>

              <textarea
                value={csvText}
                onChange={(e) => { setCsvText(e.target.value); setParsed(null); }}
                rows={8}
                placeholder={t("pastePlaceholder")}
                style={{
                  ...inputStyle,
                  resize: "vertical",
                  fontFamily: "monospace",
                  lineHeight: 1.5,
                }}
              />

              {parseError && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: D.danger,
                  }}
                >
                  <AlertTriangle size={14} strokeWidth={1.5} />
                  {parseError}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: "9px 18px",
                    fontSize: 13,
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
                  type="button"
                  onClick={handleParse}
                  style={{
                    padding: "9px 18px",
                    fontSize: 13,
                    fontWeight: 600,
                    background: D.ink,
                    border: "none",
                    borderRadius: 6,
                    color: "#000",
                    cursor: "pointer",
                  }}
                >
                  {t("parse")}
                </button>
              </div>
            </>
          ) : (
            /* Preview + mapping step */
            <>
              <p style={{ fontSize: 13, color: D.muted, margin: 0 }}>
                {t("previewDescription", { count: parsed.length })}
              </p>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      {[t("colCampaign"), t("colStart"), t("colEnd"), t("colAmount"), t("colProduct")].map((h) => (
                        <th
                          key={h}
                          style={{
                            padding: "8px 10px",
                            textAlign: "start",
                            fontSize: 10,
                            fontWeight: 600,
                            color: D.tertiary,
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            borderBottom: `1px solid ${D.border}`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((row, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${D.border}` }}>
                        <td style={{ padding: "8px 10px", color: D.ink, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.campaign_name}
                        </td>
                        <td style={{ padding: "8px 10px", color: D.muted, whiteSpace: "nowrap" }}>{row.period_start}</td>
                        <td style={{ padding: "8px 10px", color: D.muted, whiteSpace: "nowrap" }}>{row.period_end}</td>
                        <td style={{ padding: "8px 10px", color: D.ink, fontVariantNumeric: "tabular-nums", textAlign: "end" }}>
                          {row.amount.toFixed(2)}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <select
                            value={mappings[row.campaign_name] ?? ""}
                            onChange={(e) =>
                              setMappings((m) => ({ ...m, [row.campaign_name]: e.target.value }))
                            }
                            style={{ ...inputStyle, width: 160 }}
                          >
                            <option value="">{t("marketWide")}</option>
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={() => { setParsed(null); setParseError(null); }}
                  style={{
                    padding: "9px 18px",
                    fontSize: 13,
                    background: "transparent",
                    border: `1px solid ${D.border}`,
                    borderRadius: 6,
                    color: D.muted,
                    cursor: "pointer",
                  }}
                >
                  {t("back")}
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={submitting}
                  style={{
                    padding: "9px 18px",
                    fontSize: 13,
                    fontWeight: 600,
                    background: submitting ? "#E1E3E5" : "#1A1A1A",
                    border: "none",
                    borderRadius: 6,
                    color: submitting ? D.tertiary : "#FFFFFF",
                    cursor: submitting ? "not-allowed" : "pointer",
                  }}
                >
                  {submitting ? "…" : t("import", { count: parsed.length })}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

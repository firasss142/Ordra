"use client";

import { useState, useRef } from "react";
import { X, Upload, AlertTriangle, Check, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { parseAdSpendCsv } from "@/lib/ad-spend/csv-parse";
import { isPeriodLocked } from "@/lib/ad-spend/period-lock";
import type { ParsedAdSpendRow } from "@/lib/ad-spend/csv-parse";
import type { CampaignsProduct } from "@/hooks/useAdSpendCampaigns";

interface MappedRow extends ParsedAdSpendRow {
  product_id: string | null;
}

interface AdSpendCsvImportProps {
  products: CampaignsProduct[];
  marketId: string;
  onClose: () => void;
  onImport: (
    rows: MappedRow[],
    confirmLockedPeriod?: boolean,
  ) => Promise<{ inserted: number; rejected: { index: number; reason: string }[] }>;
  /** super_admin is the only role the route will let past a closed period. */
  canConfirmLocked?: boolean;
}


export function AdSpendCsvImport({
  products,
  onClose,
  onImport,
  canConfirmLocked = false,
}: AdSpendCsvImportProps) {
  const t = useTranslations("adSpend.import");
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState<ParsedAdSpendRow[] | null>(null);
  const [mappings, setMappings] = useState<Record<string, string>>({}); // campaign_name → product_id or ""
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; rejected: number } | null>(null);
  const [confirmLocked, setConfirmLocked] = useState(false);

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
      const res = await onImport(rows, confirmLocked);
      setResult({ inserted: res.inserted, rejected: res.rejected.length });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mscrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mbox w" role="dialog" aria-modal="true" aria-labelledby="ads-import-t">
        <div className="dr-h">
          <div>
            <h2 id="ads-import-t">{t("title")}</h2>
            {!result && <p>{parsed ? t("previewDescription", { count: parsed.length }) : t("description")}</p>}
          </div>
          <button type="button" className="dr-x" onClick={onClose} aria-label={t("close")}>
            <X className="ic" aria-hidden />
          </button>
        </div>

        {result ? (
          /* Success state */
          <>
            <div className="mb">
              <div className="done">
                <b>
                  <Check className="ic" aria-hidden /> {t("successTitle", { count: result.inserted })}
                </b>
                {result.rejected > 0 && <span>{t("successRejected", { count: result.rejected })}</span>}
              </div>
            </div>
            <div className="mf">
              <button type="button" className="btn" onClick={onClose}>
                {t("close")}
              </button>
            </div>
          </>
        ) : !parsed ? (
          /* Input step */
          <>
            <div className="mb">
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: "none" }} />
              <div className="drop">
                <span className="hold"><FileText className="ic" aria-hidden /></span>
                <span>
                  <b>{t("dropTitle")}</b>
                  <small>{t("dropHint")}</small>
                </span>
                <button type="button" className="btn2 sm" onClick={() => fileRef.current?.click()}>
                  <Upload className="ic" aria-hidden />
                  {t("chooseFile")}
                </button>
              </div>

              <span className="or">{t("orPaste")}</span>

              <textarea
                className="inp"
                value={csvText}
                onChange={(e) => { setCsvText(e.target.value); setParsed(null); }}
                rows={8}
                placeholder={t("pastePlaceholder")}
              />

              {parseError && (
                <p role="alert" className="ferr">
                  <AlertTriangle className="ic" aria-hidden style={{ verticalAlign: "-3px", marginInlineEnd: 6 }} />
                  {parseError}
                </p>
              )}
            </div>
            <div className="mf">
              <button type="button" className="btn2" onClick={onClose}>
                {t("cancel")}
              </button>
              <button type="button" className="btn" onClick={handleParse}>
                {t("parse")}
              </button>
            </div>
          </>
        ) : (
          /* Preview + mapping step */
          <>
            <div className="mb">
              <div className="pv">
                <table>
                  <thead>
                    <tr>
                      {[t("colCampaign"), t("colStart"), t("colEnd"), t("colAmount"), t("colProduct")].map((h, i) => (
                        <th key={h} style={i === 3 ? { textAlign: "end" } : undefined}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((row, i) => (
                      <tr key={i}>
                        <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{row.campaign_name}</td>
                        <td>{row.period_start}</td>
                        <td>{row.period_end}</td>
                        <td className="n">{row.amount.toFixed(2)}</td>
                        <td>
                          <select
                            className="inp sm"
                            value={mappings[row.campaign_name] ?? ""}
                            onChange={(e) => setMappings((m) => ({ ...m, [row.campaign_name]: e.target.value }))}
                            style={{ width: 180 }}
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

              {/* A backfill lands in a closed quarter more often than not, and the
                  import route runs the same lock the entry modal does. Without an
                  explicit confirmation every such row comes back rejected as
                  `locked_period` and the UI could only call it "invalid". */}
              {canConfirmLocked && parsed.some((r) => isPeriodLocked(r.period_end)) && (
                <label className="chk">
                  <input type="checkbox" checked={confirmLocked} onChange={(e) => setConfirmLocked(e.target.checked)} />
                  <span>{t("confirmLockedImport")}</span>
                </label>
              )}
            </div>
            <div className="mf">
              <button type="button" className="btn2" onClick={() => { setParsed(null); setParseError(null); }}>
                {t("back")}
              </button>
              <span className="grow" />
              <button type="button" className="btn" onClick={handleImport} disabled={submitting}>
                {submitting ? "…" : t("import", { count: parsed.length })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

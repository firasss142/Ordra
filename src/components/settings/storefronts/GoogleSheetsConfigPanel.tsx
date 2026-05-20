"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const SUPPORTED_PLATFORMS = ["converty"] as const;
type SheetPlatform = (typeof SUPPORTED_PLATFORMS)[number];

interface SheetSource {
  storefront_id: string;
  spreadsheet_id: string;
  sheet_name: string;
  platform: SheetPlatform;
  is_active: boolean;
}

interface GoogleSheetsConfigPanelProps {
  marketId: string;
  sources: SheetSource[];
  onSave: (sources: SheetSource[]) => Promise<void>;
}

const EMPTY_FORM: Omit<SheetSource, "storefront_id"> = {
  spreadsheet_id: "",
  sheet_name: "Orders",
  platform: "converty",
  is_active: true,
};

export function GoogleSheetsConfigPanel({
  marketId,
  sources,
  onSave,
}: GoogleSheetsConfigPanelProps) {
  const t = useTranslations("settings.googleSheets.config");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  void marketId;

  async function handleAdd() {
    if (!form.spreadsheet_id.trim() || !form.sheet_name.trim()) {
      setError(t("validation.required"));
      return;
    }

    const newSource: SheetSource = {
      ...form,
      storefront_id: crypto.randomUUID(),
      spreadsheet_id: form.spreadsheet_id.trim(),
      sheet_name: form.sheet_name.trim(),
    };

    setSaving(true);
    setError(null);
    try {
      await onSave([...sources, newSource]);
      setAdding(false);
      setForm(EMPTY_FORM);
    } catch {
      setError(t("validation.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(storefrontId: string) {
    const updated = sources.map((s) =>
      s.storefront_id === storefrontId ? { ...s, is_active: !s.is_active } : s
    );
    await onSave(updated);
  }

  async function handleRemove(storefrontId: string) {
    const updated = sources.filter((s) => s.storefront_id !== storefrontId);
    await onSave(updated);
  }

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #ECEEF0",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: sources.length > 0 || adding ? "1px solid #ECEEF0" : undefined,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1A1A" }}>
            {t("title")}
          </div>
          <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
            {t("subtitle")}
          </div>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "#1A1A1A",
              background: "#F6F6F7",
              border: "1px solid #E1E3E5",
              borderRadius: 6,
              padding: "6px 14px",
              cursor: "pointer",
            }}
          >
            {t("addSource")}
          </button>
        )}
      </div>

      {/* Existing sources */}
      {sources.map((source) => (
        <div
          key={source.storefront_id}
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid #ECEEF0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "#1A1A1A" }}>
              {source.spreadsheet_id.slice(0, 20)}…
            </div>
            <div style={{ fontSize: 12, color: "#6D7175", marginTop: 1 }}>
              {source.platform} · {source.sheet_name}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: source.is_active ? "#008060" : "#6D7175",
                background: source.is_active ? "#F1F8F5" : "#F6F6F7",
                border: `1px solid ${source.is_active ? "#C3E6D8" : "#E1E3E5"}`,
                borderRadius: 4,
                padding: "2px 8px",
              }}
            >
              {source.is_active ? t("active") : t("inactive")}
            </span>
            <button
              onClick={() => handleToggle(source.storefront_id)}
              style={{
                fontSize: 12,
                color: "#6D7175",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 6px",
                borderRadius: 4,
              }}
            >
              {source.is_active ? t("disable") : t("enable")}
            </button>
            <button
              onClick={() => handleRemove(source.storefront_id)}
              style={{
                fontSize: 12,
                color: "#D72C0D",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 6px",
                borderRadius: 4,
              }}
              aria-label={t("removeAriaLabel")}
            >
              {t("remove")}
            </button>
          </div>
        </div>
      ))}

      {/* Add form */}
      {adding && (
        <div style={{ padding: "16px 20px", borderTop: sources.length > 0 ? "1px solid #ECEEF0" : undefined }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label
                style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#6D7175", marginBottom: 4 }}
              >
                {t("spreadsheetId")}
              </label>
              <input
                value={form.spreadsheet_id}
                onChange={(e) => setForm((f) => ({ ...f, spreadsheet_id: e.target.value }))}
                placeholder={t("spreadsheetIdPlaceholder")}
                style={{
                  width: "100%",
                  fontSize: 13,
                  padding: "7px 10px",
                  border: "1px solid #E1E3E5",
                  borderRadius: 6,
                  outline: "none",
                  boxSizing: "border-box",
                  color: "#1A1A1A",
                }}
              />
            </div>
            <div>
              <label
                style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#6D7175", marginBottom: 4 }}
              >
                {t("sheetName")}
              </label>
              <input
                value={form.sheet_name}
                onChange={(e) => setForm((f) => ({ ...f, sheet_name: e.target.value }))}
                placeholder="Orders"
                style={{
                  width: "100%",
                  fontSize: 13,
                  padding: "7px 10px",
                  border: "1px solid #E1E3E5",
                  borderRadius: 6,
                  outline: "none",
                  boxSizing: "border-box",
                  color: "#1A1A1A",
                }}
              />
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label
              style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#6D7175", marginBottom: 4 }}
            >
              {t("platform")}
            </label>
            <select
              value={form.platform}
              onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value as SheetPlatform }))}
              style={{
                fontSize: 13,
                padding: "7px 10px",
                border: "1px solid #E1E3E5",
                borderRadius: 6,
                outline: "none",
                color: "#1A1A1A",
                background: "#FFFFFF",
              }}
            >
              {SUPPORTED_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <div style={{ fontSize: 12, color: "#D72C0D", marginBottom: 10 }} role="alert">
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleAdd}
              disabled={saving}
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "#FFFFFF",
                background: "#1A1A1A",
                border: "none",
                borderRadius: 6,
                padding: "7px 16px",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? t("saving") : t("save")}
            </button>
            <button
              onClick={() => { setAdding(false); setForm(EMPTY_FORM); setError(null); }}
              style={{
                fontSize: 13,
                color: "#6D7175",
                background: "none",
                border: "1px solid #E1E3E5",
                borderRadius: 6,
                padding: "7px 16px",
                cursor: "pointer",
              }}
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      )}

      {sources.length === 0 && !adding && (
        <div style={{ padding: "16px 20px", fontSize: 13, color: "#6D7175" }}>
          {t("noSources")}
        </div>
      )}
    </div>
  );
}

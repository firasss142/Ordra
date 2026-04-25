"use client";

import React from "react";
import { useTranslations } from "next-intl";

interface BulkActionBarProps {
  selectedCount: number;
  loading: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onClear: () => void;
}

const TEXT = "#1A1A1A";
const BORDER = "#E1E3E5";
const MUTED = "#6D7175";

export function BulkActionBar({
  selectedCount,
  loading,
  onActivate,
  onDeactivate,
  onClear,
}: BulkActionBarProps) {
  const t = useTranslations("products");

  if (selectedCount === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: "#F0F0F0",
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        marginBottom: 8,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 500, color: TEXT }}>
        {t("bulk.selectedCount", { count: selectedCount })}
      </span>
      <button
        type="button"
        onClick={onActivate}
        disabled={loading}
        style={actionBtn(loading)}
      >
        {t("bulk.activate")}
      </button>
      <button
        type="button"
        onClick={onDeactivate}
        disabled={loading}
        style={actionBtn(loading)}
      >
        {t("bulk.deactivate")}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={loading}
        style={{
          padding: "5px 12px",
          fontSize: 13,
          fontWeight: 500,
          border: `1px solid ${BORDER}`,
          borderRadius: 9999,
          background: "#FFFFFF",
          color: MUTED,
          cursor: loading ? "not-allowed" : "pointer",
        }}
      >
        {t("bulk.clear")}
      </button>
    </div>
  );
}

function actionBtn(loading: boolean): React.CSSProperties {
  return {
    padding: "5px 12px",
    fontSize: 13,
    fontWeight: 500,
    border: `1px solid ${TEXT}`,
    borderRadius: 9999,
    background: TEXT,
    color: "#FFFFFF",
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.6 : 1,
  };
}

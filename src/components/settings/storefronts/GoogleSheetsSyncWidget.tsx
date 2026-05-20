"use client";

import { useTranslations } from "next-intl";
import { useGoogleSheetsSync } from "@/hooks/useGoogleSheetsSync";

interface GoogleSheetsSyncWidgetProps {
  marketId: string;
}

export function GoogleSheetsSyncWidget({ marketId }: GoogleSheetsSyncWidgetProps) {
  const t = useTranslations("settings.googleSheets");
  const { status, isLoading, isSyncing, syncError, triggerSync, hasSheets } =
    useGoogleSheetsSync(marketId);

  if (!isLoading && !hasSheets) return null;

  const totalRows = status?.sources.reduce((sum, s) => sum + s.last_row, 0) ?? 0;

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #ECEEF0",
        borderRadius: 8,
        padding: "16px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {/* Google Sheets icon */}
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <rect width="20" height="20" rx="3" fill="#0F9D58" />
          <path
            d="M5 6h10v2H5V6zm0 3h10v2H5V9zm0 3h6v2H5v-2z"
            fill="white"
          />
        </svg>
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#1A1A1A",
              lineHeight: "18px",
            }}
          >
            {t("title")}
          </div>
          {!isLoading && status && (
            <div
              style={{
                fontSize: 12,
                color: "#6D7175",
                lineHeight: "16px",
                marginTop: 1,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {totalRows > 0 ? t("rowsSynced", { count: totalRows }) : t("neverSynced")}
            </div>
          )}
          {syncError && (
            <div
              style={{ fontSize: 12, color: "#D72C0D", lineHeight: "16px", marginTop: 1 }}
              role="alert"
            >
              {syncError}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={triggerSync}
        disabled={isSyncing || isLoading}
        aria-busy={isSyncing}
        style={{
          fontSize: 13,
          fontWeight: 500,
          color: isSyncing ? "#6D7175" : "#1A1A1A",
          background: "#F6F6F7",
          border: "1px solid #E1E3E5",
          borderRadius: 6,
          padding: "6px 14px",
          cursor: isSyncing || isLoading ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
          transition: "background 150ms ease, color 150ms ease",
          opacity: isSyncing || isLoading ? 0.6 : 1,
        }}
      >
        {isSyncing ? t("syncing") : t("syncNow")}
      </button>
    </div>
  );
}

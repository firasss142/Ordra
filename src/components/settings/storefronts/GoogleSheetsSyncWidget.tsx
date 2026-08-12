"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { useGoogleSheetsSync } from "@/hooks/useGoogleSheetsSync";

interface GoogleSheetsSyncWidgetProps {
  marketId: string;
}

export function GoogleSheetsSyncWidget({ marketId }: GoogleSheetsSyncWidgetProps) {
  const t = useTranslations("settings.googleSheets");
  const {
    status,
    isLoading,
    isSyncing,
    syncError,
    triggerSync,
    hasSheets,
    isBroken,
    failures,
    lastSuccessAt,
  } = useGoogleSheetsSync(marketId);

  if (!isLoading && !hasSheets) return null;

  const totalRows = status?.sources.reduce((sum, s) => sum + s.last_row, 0) ?? 0;
  const catchingUp = status?.sources.some((s) => s.last_success?.has_more) ?? false;

  /**
   * A row count is not a health reading.
   *
   * This widget used to show "{n} lignes synchronisées" and nothing else, which
   * is the same sentence whether the import ran a minute ago or died four days
   * ago — the number simply stops moving. The state of the last *completed* run
   * is what an operator needs, and a broken import says so in red.
   */
  const since = lastSuccessAt
    ? new Intl.RelativeTimeFormat("fr", { numeric: "auto" }).format(
        -Math.round((Date.now() - new Date(lastSuccessAt).getTime()) / 3_600_000),
        "hour",
      )
    : null;

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
              data-testid="sheets-sync-health"
              style={{
                fontSize: 12,
                color: isBroken ? "#D72C0D" : "#6D7175",
                fontWeight: isBroken ? 600 : 400,
                lineHeight: "16px",
                marginTop: 1,
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontVariantNumeric: "tabular-nums",
              }}
              role={isBroken ? "alert" : undefined}
            >
              {isBroken && <AlertTriangle size={12} strokeWidth={2.2} aria-hidden />}
              {isBroken
                ? since
                  ? t("brokenHint", { since })
                  : t("brokenNever")
                : since
                  ? t("healthy", { since })
                  : totalRows > 0
                    ? t("rowsSynced", { count: totalRows })
                    : t("neverSynced")}
            </div>
          )}
          {!isLoading && catchingUp && !isBroken && (
            <div style={{ fontSize: 12, color: "#B98900", lineHeight: "16px", marginTop: 1 }}>
              {t("catchingUp")}
            </div>
          )}
          {failures.length > 0 && (
            <div
              data-testid="sheets-failed-rows"
              title={failures
                .slice(0, 5)
                .map((f) => `#${f.row_index}: ${f.message}`)
                .join("\n")}
              style={{ fontSize: 12, color: "#B98900", lineHeight: "16px", marginTop: 1 }}
            >
              {t("failedRows", { count: failures.length })}
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

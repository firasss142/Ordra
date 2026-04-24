"use client";

import { useState } from "react";
import { Lock, Package, Globe, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AdSpendWithMetrics } from "@/lib/ad-spend/realized-metrics";
import { isPeriodLocked } from "@/lib/ad-spend/period-lock";
import { formatDate } from "@/lib/format";
import { AD_SPEND_THEME as D } from "./theme";

interface AdSpendCampaignCardProps {
  entry: AdSpendWithMetrics;
  productName: string | null;
  currency: string;
  locale: string;
  canEditLocked: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function formatNumber(n: number, locale: string, decimals = 0): string {
  return n.toLocaleString(locale === "ar" ? "ar" : "fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function MetricRow({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "success" | "warning" | "critical" | "neutral";
}) {
  const color =
    tone === "success"
      ? D.accent
      : tone === "warning"
        ? D.warning
        : tone === "critical"
          ? D.danger
          : D.white;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: D.tertiary,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 11, color: D.muted }}>{sub}</span>
    </div>
  );
}

export function AdSpendCampaignCard({
  entry,
  productName,
  currency,
  locale,
  canEditLocked,
  onEdit,
  onDelete,
}: AdSpendCampaignCardProps) {
  const t = useTranslations("adSpend.card");
  const [hovered, setHovered] = useState(false);

  const locked = isPeriodLocked(entry.period_end);
  const editDisabled = locked && !canEditLocked;

  const roasTone =
    entry.roas == null
      ? "neutral"
      : entry.roas >= 2
        ? "success"
        : entry.roas >= 1
          ? "warning"
          : "critical";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: D.cardBg,
        border: `1px solid ${hovered ? D.borderHover : D.border}`,
        borderRadius: 12,
        boxShadow: D.shadow,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        transition: "border-color 150ms ease",
      }}
    >
      {/* Top: product tag + lock */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 9999,
            background: productName
              ? "rgba(54,244,164,0.08)"
              : "rgba(127,184,245,0.08)",
            border: `1px solid ${productName ? "rgba(54,244,164,0.2)" : "rgba(127,184,245,0.2)"}`,
            color: productName ? D.accent : D.info,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {productName ? (
            <Package size={12} strokeWidth={2} />
          ) : (
            <Globe size={12} strokeWidth={2} />
          )}
          <span
            style={{
              maxWidth: 180,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {productName ?? t("marketWide")}
          </span>
        </div>
        {locked && (
          <span
            title={t("lockedTooltip")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: D.warning,
              background: "rgba(245,197,99,0.1)",
              border: "1px solid rgba(245,197,99,0.25)",
              borderRadius: 9999,
              padding: "2px 8px",
              fontWeight: 600,
            }}
          >
            <Lock size={11} strokeWidth={2} />
            {t("locked")}
          </span>
        )}
      </div>

      {/* Period */}
      <div style={{ fontSize: 12, color: D.tertiary, fontWeight: 500 }}>
        {formatDate(entry.period_start, locale)} — {formatDate(entry.period_end, locale)}
      </div>

      {/* Big spend */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontSize: 30,
            fontWeight: 700,
            color: D.white,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {formatNumber(entry.amount, locale, 0)}
        </span>
        <span style={{ fontSize: 12, color: D.tertiary }}>{currency}</span>
      </div>

      {/* Realized metrics grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          padding: "12px 0 0",
          borderTop: `1px solid ${D.border}`,
        }}
      >
        <MetricRow
          label={t("confirmations")}
          value={formatNumber(entry.confirmed_count, locale)}
          sub={
            entry.cost_per_confirmation != null
              ? `${formatNumber(entry.cost_per_confirmation, locale, 1)} ${currency} / ${t("conf")}`
              : t("none")
          }
        />
        <MetricRow
          label={t("roas")}
          value={entry.roas != null ? `${formatNumber(entry.roas, locale, 1)}×` : "—"}
          sub={
            entry.revenue > 0
              ? `${formatNumber(entry.revenue, locale, 0)} ${currency} ${t("revenue")}`
              : t("noRevenue")
          }
          tone={roasTone}
        />
      </div>

      {/* Note */}
      {entry.note && (
        <div style={{ fontSize: 12, color: D.muted, fontStyle: "italic" }}>
          "{entry.note}"
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 4 }}>
        <button
          type="button"
          onClick={onEdit}
          disabled={editDisabled}
          style={{
            flex: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${D.border}`,
            background: "transparent",
            color: editDisabled ? D.tertiary : D.white,
            cursor: editDisabled ? "not-allowed" : "pointer",
          }}
        >
          <Pencil size={13} strokeWidth={1.5} />
          {t("edit")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={editDisabled}
          style={{
            flex: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${editDisabled ? D.border : "rgba(244,114,114,0.3)"}`,
            background: "transparent",
            color: editDisabled ? D.tertiary : D.danger,
            cursor: editDisabled ? "not-allowed" : "pointer",
          }}
        >
          <Trash2 size={13} strokeWidth={1.5} />
          {t("delete")}
        </button>
      </div>
    </div>
  );
}

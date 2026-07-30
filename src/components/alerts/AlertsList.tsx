"use client";

import Link from "next/link";
import { Bell, CheckCircle2 } from "lucide-react";
import type { Alert } from "@/app/api/alerts/summary/route";
import { SEVERITY_COLORS, TYPE_ICONS } from "./constants";
import { formatMeta, type AlertsTranslator } from "./format";

export function AlertRow({
  alert,
  selected,
  onToggle,
  locale,
  t,
  onNavigate,
}: {
  alert: Alert;
  selected: boolean;
  onToggle: () => void;
  locale: string;
  t: AlertsTranslator;
  /** Called when the user follows the alert's link (e.g. to close a hosting panel). */
  onNavigate?: () => void;
}) {
  const colors = SEVERITY_COLORS[alert.severity];
  const Icon = TYPE_ICONS[alert.type] ?? Bell;
  const metaLabel = formatMeta(alert, t);
  const typeLabel = t(`types.${alert.type}.label`);
  const href = `/${locale}${alert.href}`;

  return (
    <li>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 12px",
          border: selected ? "1px solid #1A1A1A" : "1px solid #E1E3E5",
          borderRadius: 6,
          backgroundColor: selected ? "#F7F7F7" : "#FFFFFF",
          transition: "background-color 120ms ease, border-color 120ms ease",
        }}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={t("selectAlert", { title: alert.primary || typeLabel })}
          style={{ cursor: "pointer", flexShrink: 0 }}
        />
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            backgroundColor: colors.bg,
            color: colors.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <Link
          href={href}
          onClick={onNavigate}
          style={{
            flex: 1,
            minWidth: 0,
            textDecoration: "none",
            color: "#1A1A1A",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {alert.primary || typeLabel}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "#6D7175",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ fontWeight: 500 }}>{typeLabel}</span>
            {alert.secondary ? ` · ${alert.secondary}` : null}
          </div>
        </Link>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            color: colors.fg,
            backgroundColor: colors.bg,
            padding: "3px 8px",
            borderRadius: 4,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {metaLabel}
        </span>
      </div>
    </li>
  );
}

export function AllClear({
  t,
  total,
  hasFilter,
}: {
  t: AlertsTranslator;
  total: number;
  hasFilter: boolean;
}) {
  return (
    <div
      style={{
        minHeight: 180,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      <CheckCircle2 size={28} strokeWidth={1.5} color="#008060" />
      <div style={{ fontSize: 14, fontWeight: 500, color: "#1A1A1A" }}>
        {total === 0 ? t("allClearTitle") : t("noneMatchFilter")}
      </div>
      <div style={{ fontSize: 12, color: "#6D7175" }}>
        {total === 0 || !hasFilter ? t("allClearSubtitle") : t("adjustFilters")}
      </div>
    </div>
  );
}

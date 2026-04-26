"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { formatDateTime, formatCurrency } from "@/lib/format";
import { FollowUpStatusBadge } from "./FollowUpStatusBadge";
import type { OrderFollowUpWithOrder } from "@/types/follow-up";

interface Props {
  followUps: OrderFollowUpWithOrder[];
  isLoading: boolean;
  locale: string;
  marketCode: "TN" | "LY";
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  textAlign: "start",
  fontSize: 13,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #E1E3E5",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 14,
  color: "#1A1A1A",
  borderBottom: "1px solid #E1E3E5",
};

const pagerBtn: React.CSSProperties = {
  height: 32,
  padding: "0 12px",
  fontSize: 13,
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  background: "white",
  color: "#1A1A1A",
  outline: "none",
};

export function FollowUpList({
  followUps,
  isLoading,
  locale,
  marketCode,
  total,
  page,
  totalPages,
  onPageChange,
}: Props) {
  const t = useTranslations("crm.followUps");
  const localeHref = `/${locale}/follow-ups`;

  return (
    <div>
      <div
        style={{
          background: "white",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 880, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("columns.customer")}</th>
              <th style={thStyle}>{t("columns.phone")}</th>
              <th style={thStyle}>{t("columns.order")}</th>
              <th style={thStyle}>{t("columns.deliveryMan")}</th>
              <th style={thStyle}>{t("columns.status")}</th>
              <th style={thStyle}>{t("columns.updated")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && followUps.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{ ...tdStyle, textAlign: "center", padding: 48 }}
                >
                  …
                </td>
              </tr>
            ) : followUps.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    ...tdStyle,
                    textAlign: "center",
                    padding: 48,
                    color: "#6D7175",
                  }}
                >
                  {t("emptyState")}
                </td>
              </tr>
            ) : (
              followUps.map((f) => (
                <tr key={f.id}>
                  <td style={tdStyle}>
                    <Link
                      href={`${localeHref}/${f.id}`}
                      style={{
                        color: "#1A1A1A",
                        textDecoration: "none",
                        fontWeight: 500,
                      }}
                    >
                      {f.order.customer_name}
                    </Link>
                    {f.order.customer_city && (
                      <div style={{ fontSize: 12, color: "#6B7280" }}>
                        {f.order.customer_city}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <a
                      href={`tel:${f.order.customer_phone}`}
                      style={{ color: "#1A1A1A", textDecoration: "none" }}
                    >
                      {f.order.customer_phone}
                    </a>
                  </td>
                  <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
                    {formatCurrency(f.order.total_price, marketCode)}
                    <div
                      style={{
                        fontSize: 11,
                        color: "#1A1A1A",
                        marginTop: 4,
                        background: "#F6F6F7",
                        borderRadius: 4,
                        padding: "2px 6px",
                        display: "inline-block",
                      }}
                    >
                      {f.order.status}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, color: "#4B5563", fontSize: 13 }}>
                    {f.delivery_man_phone ?? "—"}
                  </td>
                  <td style={tdStyle}>
                    <FollowUpStatusBadge status={f.status} />
                  </td>
                  <td style={{ ...tdStyle, color: "#6B7280", fontSize: 13 }}>
                    {formatDateTime(f.updated_at, locale)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 16,
          fontSize: 13,
          color: "#6D7175",
        }}
      >
        <span>{t("totalCount", { count: total })}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
            style={{
              ...pagerBtn,
              cursor: page <= 1 ? "not-allowed" : "pointer",
              color: page <= 1 ? "#9CA3AF" : "#1A1A1A",
            }}
          >
            {t("previous")}
          </button>
          <span>{t("pageOf", { page, total: totalPages })}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            style={{
              ...pagerBtn,
              cursor: page >= totalPages ? "not-allowed" : "pointer",
              color: page >= totalPages ? "#9CA3AF" : "#1A1A1A",
            }}
          >
            {t("next")}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { useCustomerSearch } from "@/hooks/useCustomerSearch";
import { formatCurrency } from "@/lib/format";
import type { CustomerSearchResult } from "@/types/follow-up";

interface Props {
  marketId?: string | null;
  marketCode?: "TN" | "LY";
  onPick: (result: CustomerSearchResult) => void;
  disabled?: boolean;
}

export function CustomerPhoneSearch({
  marketId,
  marketCode = "TN",
  onPick,
  disabled,
}: Props) {
  const t = useTranslations("crm.followUps");
  const tOrderStatuses = useTranslations("orders.statuses");
  const [phone, setPhone] = useState("");
  const { results, isLoading, enabled } = useCustomerSearch(phone, marketId);

  return (
    <div style={{ position: "relative" }}>
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        disabled={disabled}
        placeholder={t("searchCustomer")}
        style={{
          width: "100%",
          height: 36,
          padding: "0 10px",
          fontSize: 14,
          border: "1px solid #D1D5DB",
          borderRadius: 6,
          background: "white",
          color: "#1A1A1A",
          outline: "none",
        }}
      />

      {enabled && (
        <div
          style={{
            marginTop: 4,
            border: "1px solid #E1E3E5",
            borderRadius: 6,
            background: "white",
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {isLoading && (
            <div style={{ padding: 12, fontSize: 13, color: "#6B7280" }}>
              {t("searching")}
            </div>
          )}
          {!isLoading && results.length === 0 && (
            <div style={{ padding: 12, fontSize: 13, color: "#6B7280" }}>
              {t("noMatches")}
            </div>
          )}
          {!isLoading &&
            results.map((r) => {
              const alreadyHas = r.has_follow_up;
              return (
                <button
                  key={r.order_id}
                  type="button"
                  disabled={alreadyHas}
                  onClick={() => !alreadyHas && onPick(r)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "start",
                    padding: "10px 12px",
                    fontSize: 13,
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid #F1F3F5",
                    color: alreadyHas ? "#9CA3AF" : "#1A1A1A",
                    cursor: alreadyHas ? "not-allowed" : "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <strong>{r.customer_name}</strong>
                    <span style={{ color: "#6B7280" }}>
                      {formatCurrency(r.total_price, marketCode)}
                    </span>
                  </div>
                  <div style={{ color: "#6B7280", marginTop: 2 }}>
                    {r.customer_phone}
                    {r.customer_city ? ` · ${r.customer_city}` : ""}
                    {" · "}
                    <span>{tOrderStatuses(r.status)}</span>
                  </div>
                  {alreadyHas && (
                    <div
                      style={{
                        marginTop: 4,
                        display: "inline-block",
                        fontSize: 11,
                        background: "#FEF3C7",
                        color: "#92400E",
                        padding: "1px 6px",
                        borderRadius: 4,
                      }}
                    >
                      {t("alreadyHasFollowUp")}
                    </div>
                  )}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

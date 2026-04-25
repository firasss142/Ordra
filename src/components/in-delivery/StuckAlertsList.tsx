"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, Flag } from "lucide-react";
import type { InDeliveryStuckOrder } from "@/app/api/in-delivery/summary/route";
import { EscalateCarrierModal } from "./EscalateCarrierModal";

export function StuckAlertsList({
  stuckOrders,
  locale,
  onEscalated,
}: {
  stuckOrders: InDeliveryStuckOrder[];
  locale: string;
  onEscalated: () => void;
}) {
  const t = useTranslations("inDelivery.stuck");
  const tStatus = useTranslations("orders.statuses");
  const [escalating, setEscalating] = useState<InDeliveryStuckOrder | null>(null);

  if (stuckOrders.length === 0) {
    return (
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 6,
          padding: 24,
          fontSize: 13,
          color: "#6D7175",
          textAlign: "center",
        }}
      >
        {t("empty")}
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 6,
          overflow: "hidden",
        }}
      >
        <table
          style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}
        >
          <thead>
            <tr style={{ backgroundColor: "#F6F6F7" }}>
              <Th>{t("col.customer")}</Th>
              <Th>{t("col.city")}</Th>
              <Th>{t("col.carrier")}</Th>
              <Th>{t("col.status")}</Th>
              <Th right>{t("col.age")}</Th>
              <Th right>{t("col.action")}</Th>
            </tr>
          </thead>
          <tbody>
            {stuckOrders.map((order) => (
              <tr key={order.id}>
                <Td>
                  <Link
                    href={`/${locale}/in-delivery/${order.id}`}
                    style={{ color: "#1A1A1A", textDecoration: "none", fontWeight: 500 }}
                  >
                    {order.customer_name || "—"}
                  </Link>
                  {order.external_id && (
                    <div style={{ fontSize: 11, color: "#6D7175", marginTop: 2 }}>
                      #{order.external_id}
                    </div>
                  )}
                </Td>
                <Td>{order.customer_city || "—"}</Td>
                <Td>{order.carrier_name || "—"}</Td>
                <Td>
                  <StatusPill status={order.status} label={tStatus(order.status)} />
                </Td>
                <Td right>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontVariantNumeric: "tabular-nums",
                      color: order.age_hours > 24 * 5 ? "#D72C0D" : "#B98900",
                      fontWeight: 500,
                    }}
                  >
                    <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
                    {t("ageValue", { d: Math.round((order.age_hours / 24) * 10) / 10 })}
                  </span>
                </Td>
                <Td right>
                  {order.needs_carrier_followup ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        fontSize: 12,
                        fontWeight: 500,
                        color: "#008060",
                      }}
                    >
                      <Flag size={12} strokeWidth={2} aria-hidden="true" />
                      {t("escalated")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEscalating(order)}
                      style={{
                        all: "unset",
                        cursor: "pointer",
                        padding: "4px 10px",
                        border: "1px solid #D1D5DB",
                        borderRadius: 4,
                        fontSize: 12,
                        fontWeight: 500,
                        color: "#1A1A1A",
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      {t("escalate")}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {escalating && (
        <EscalateCarrierModal
          orderId={escalating.id}
          customerName={escalating.customer_name || t("anonymous")}
          onClose={() => setEscalating(null)}
          onEscalated={() => {
            setEscalating(null);
            onEscalated();
          }}
        />
      )}
    </>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      style={{
        padding: "12px 16px",
        fontSize: 13,
        fontWeight: 500,
        color: "#6D7175",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        textAlign: right ? "end" : "start",
        borderBlockEnd: "1px solid #D1D5DB",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td
      style={{
        padding: "12px 16px",
        fontSize: 14,
        color: "#1A1A1A",
        borderBlockEnd: "1px solid #E1E3E5",
        textAlign: right ? "end" : "start",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}

function StatusPill({ status, label }: { status: string; label: string }) {
  const tone =
    status === "to_be_returned" ? "critical" : status === "dispatched" ? "action" : "neutral";
  const bg =
    tone === "critical" ? "#FFF4F4" : tone === "action" ? "#EAF2FB" : "#F6F6F7";
  const fg =
    tone === "critical" ? "#D72C0D" : tone === "action" ? "#2C6ECB" : "#6D7175";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 9999,
        fontSize: 13,
        fontWeight: 500,
        backgroundColor: bg,
        color: fg,
      }}
    >
      {label}
    </span>
  );
}

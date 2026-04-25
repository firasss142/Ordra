"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Flag } from "lucide-react";
import { useOrderTimeline } from "@/hooks/useOrderTimeline";
import { OrderTimeline } from "@/components/in-delivery/OrderTimeline";
import { EscalateCarrierModal } from "@/components/in-delivery/EscalateCarrierModal";

export function OrderTimelineDetail({ orderId }: { orderId: string }) {
  const t = useTranslations("inDelivery.detail");
  const tStatus = useTranslations("orders.statuses");
  const { timeline, isLoading, error, mutate } = useOrderTimeline(orderId);
  const [escalating, setEscalating] = useState(false);

  if (error) {
    return (
      <div
        role="alert"
        style={{
          padding: "12px 14px",
          backgroundColor: "#FFF4F4",
          color: "#D72C0D",
          borderRadius: 6,
          fontSize: 13,
        }}
      >
        {t("loadError")}
      </div>
    );
  }
  if (!timeline || isLoading) {
    return (
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 6,
          padding: 24,
          fontSize: 13,
          color: "#6D7175",
        }}
      >
        {t("loading")}
      </div>
    );
  }

  const canEscalate = !timeline.order.needs_carrier_followup;

  return (
    <>
      <section
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 6,
          padding: 20,
          marginBlockEnd: 20,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <Metric label={t("status")} value={tStatus(timeline.order.status)} />
          <Metric
            label={t("carrier")}
            value={timeline.order.carrier_name || t("noCarrier")}
          />
          {timeline.order.needs_carrier_followup && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 8px",
                backgroundColor: "#F1F8F5",
                color: "#008060",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              <Flag size={12} strokeWidth={2} aria-hidden="true" />
              {t("escalated")}
            </span>
          )}
          <div style={{ flex: 1 }} />
          {canEscalate && (
            <button
              type="button"
              onClick={() => setEscalating(true)}
              style={{
                all: "unset",
                cursor: "pointer",
                padding: "8px 14px",
                borderRadius: 4,
                border: "1px solid #D1D5DB",
                fontSize: 14,
                fontWeight: 500,
                color: "#1A1A1A",
                backgroundColor: "#FFFFFF",
              }}
            >
              {t("escalateCta")}
            </button>
          )}
        </div>

        <OrderTimeline stages={timeline.stages} currentStatus={timeline.order.status} />
      </section>

      <section
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 6,
          padding: 20,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", margin: "0 0 12px" }}>
          {t("historyTitle")}
        </h2>
        {timeline.history.length === 0 ? (
          <div style={{ fontSize: 13, color: "#6D7175" }}>{t("historyEmpty")}</div>
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {timeline.history.map((h) => (
              <li
                key={h.id}
                style={{
                  padding: "10px 0",
                  borderBlockEnd: "1px solid #E1E3E5",
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: "#6D7175",
                    fontVariantNumeric: "tabular-nums",
                    width: 160,
                    flexShrink: 0,
                  }}
                >
                  {new Date(h.created_at).toLocaleString()}
                </span>
                <span style={{ flex: 1, fontSize: 13, color: "#1A1A1A" }}>
                  <strong style={{ fontWeight: 500 }}>
                    {h.status_from ? tStatus(h.status_from) : t("initial")}
                  </strong>
                  {" → "}
                  <strong style={{ fontWeight: 500 }}>{tStatus(h.status_to)}</strong>
                  <span style={{ color: "#6D7175", marginInlineStart: 8 }}>
                    ({t(`actor.${h.actor_type}`)})
                  </span>
                  {h.note && (
                    <div style={{ fontSize: 13, color: "#6D7175", marginBlockStart: 4 }}>
                      {h.note}
                    </div>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {escalating && (
        <EscalateCarrierModal
          orderId={orderId}
          customerName={timeline.order.external_id ?? orderId}
          onClose={() => setEscalating(false)}
          onEscalated={() => {
            setEscalating(false);
            mutate();
          }}
        />
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "#6D7175",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 15, fontWeight: 500, color: "#1A1A1A" }}>{value}</span>
    </div>
  );
}

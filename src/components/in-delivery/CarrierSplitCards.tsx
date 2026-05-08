"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Truck } from "lucide-react";
import type { InDeliveryCarrierRow } from "@/app/api/in-delivery/summary/route";

export function CarrierSplitCards({ carriers }: { carriers: InDeliveryCarrierRow[] }) {
  const t = useTranslations("inDelivery.carriers");

  if (carriers.length === 0) {
    return (
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 6,
          padding: 24,
          textAlign: "center",
          color: "#6D7175",
          fontSize: 13,
        }}
      >
        {t("empty")}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 12,
      }}
    >
      {carriers.map((c) => (
        <CarrierCard key={c.id} carrier={c} />
      ))}
    </div>
  );
}

function CarrierCard({ carrier }: { carrier: InDeliveryCarrierRow }) {
  const t = useTranslations("inDelivery.carriers");
  const rate = carrier.delivery_rate_30d;
  const ret = carrier.return_rate_30d;
  const medianDays =
    carrier.median_transit_hours === null ? null : carrier.median_transit_hours / 24;

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 6,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            backgroundColor: "#F1F2F4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Truck size={16} strokeWidth={1.5} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "#1A1A1A",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {carrier.name || t("unnamed")}
          </div>
          <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
            {t("inFlight", { count: carrier.in_flight_total })}
          </div>
        </div>
        {carrier.stuck_count > 0 && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: "2px 8px",
              backgroundColor: "#FFF4F4",
              color: "#D72C0D",
              borderRadius: 9999,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <AlertTriangle size={11} strokeWidth={2} aria-hidden="true" />
            {carrier.stuck_count}
          </span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 8,
          paddingBlockStart: 12,
          borderBlockStart: "1px solid #E1E3E5",
        }}
      >
        <Metric
          label={t("medianTransit")}
          value={medianDays === null ? "—" : t("daysValue", { d: medianDays.toFixed(1) })}
        />
        <Metric
          label={t("deliveryRate30d")}
          value={rate === null ? "—" : `${Math.round(rate * 100)}%`}
          tone={rate === null ? "neutral" : rate >= 0.7 ? "success" : rate >= 0.5 ? "warning" : "critical"}
        />
        <Metric
          label={t("returnRate30d")}
          value={ret === null ? "—" : `${Math.round(ret * 100)}%`}
          tone={ret === null ? "neutral" : ret <= 0.15 ? "success" : ret <= 0.3 ? "warning" : "critical"}
        />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          fontSize: 11,
          color: "#6D7175",
        }}
      >
        <StatusChip label={t("status.dispatched")} count={carrier.in_flight_by_status.dispatched} />
        <StatusChip label={t("status.deposit")} count={carrier.in_flight_by_status.deposit} />
        <StatusChip label={t("status.in_transit")} count={carrier.in_flight_by_status.in_transit} />
        <StatusChip label={t("status.to_be_returned")} count={carrier.in_flight_by_status.to_be_returned} />
      </div>

      {carrier.code === "dexpress" && (
        <div
          role="note"
          style={{
            fontSize: 11,
            color: "#6D7175",
            backgroundColor: "#F6F6F7",
            border: "1px solid #E1E3E5",
            borderRadius: 4,
            padding: "6px 8px",
            lineHeight: 1.4,
          }}
        >
          {t("manualStatusNote")}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "critical" | "neutral";
}) {
  const color =
    tone === "success"
      ? "#008060"
      : tone === "warning"
        ? "#B98900"
        : tone === "critical"
          ? "#D72C0D"
          : "#1A1A1A";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "#6D7175",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 16,
          fontWeight: 600,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function StatusChip({ label, count }: { label: string; count: number }) {
  return (
    <span
      style={{
        padding: "2px 8px",
        backgroundColor: "#F6F6F7",
        borderRadius: 9999,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {label}: <strong style={{ color: "#1A1A1A", fontWeight: 600 }}>{count}</strong>
    </span>
  );
}

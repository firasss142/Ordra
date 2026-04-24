"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, ChevronDown, ChevronRight, Truck, TrendingDown, Clock } from "lucide-react";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { useCarrierTracking } from "@/hooks/useCarrierTracking";
import { formatCurrency, formatExactTime } from "@/lib/format";
import type { AuthUser } from "@/types";

const PHASE_2_STATUSES = ["dispatched", "deposit", "in_transit", "to_be_returned"] as const;
type Phase2Status = (typeof PHASE_2_STATUSES)[number];

interface CarrierRow {
  id: string;
  name: string;
  total: number;
  by_status: Record<Phase2Status, number>;
  stuck_count: number;
  oldest_age_minutes: number | null;
  median_transit_hours: number | null;
  delivery_rates: { d7: number | null; d30: number | null; d90: number | null };
  cost: {
    period_delivered_count: number;
    period_returned_count: number;
    period_shipping_cost: number;
    per_delivered_cost: number | null;
  };
  trend_alert: boolean;
  stuck_orders: Array<{
    id: string;
    customer_name: string;
    customer_city: string;
    status: Phase2Status;
    last_update: string;
    age_hours: number;
  }>;
}

type CarrierTranslator = ReturnType<typeof useTranslations<"carrierTracking">>;

export function CarrierTrackingClient({ user }: { user: AuthUser }) {
  const t = useTranslations("carrierTracking");
  const { tracking, isLoading, error } = useCarrierTracking({
    marketId: user.role === "super_admin" ? undefined : user.market_id ?? undefined,
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const unassigned = tracking?.unassigned_carrier_count ?? 0;
  const degradingCarriers = tracking?.carriers.filter((c) => c.trend_alert) ?? [];
  const marketCode = user.locale === "ar" ? "LY" : "TN";

  return (
    <div style={{ backgroundColor: "#F6F6F7", minHeight: "100vh", padding: "32px 32px 64px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>{t("subtitle")}</p>
      </header>

      {error && (
        <div
          role="alert"
          style={{
            padding: "12px 14px",
            backgroundColor: "#FEE2E2",
            color: "#B91C1C",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {t("loadError")}
        </div>
      )}

      {degradingCarriers.length > 0 && (
        <DegradationBanner carriers={degradingCarriers} t={t} />
      )}

      {unassigned > 0 && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            backgroundColor: "#FEF3C7",
            color: "#92400E",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <AlertTriangle size={16} strokeWidth={2} aria-hidden="true" />
          {t("unassignedWarning", { count: unassigned })}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {!tracking && isLoading ? (
          <EmptyState label={t("loading")} />
        ) : !tracking || tracking.carriers.length === 0 ? (
          <EmptyState label={t("noCarriers")} />
        ) : (
          tracking.carriers.map((carrier) => (
            <CarrierCard
              key={carrier.id}
              carrier={carrier}
              locale={user.locale}
              marketCode={marketCode}
              expanded={expandedId === carrier.id}
              onToggle={() =>
                setExpandedId((prev) => (prev === carrier.id ? null : carrier.id))
              }
              t={t}
            />
          ))
        )}
      </div>

      <Panel title={t("transitions.title")} minHeight={240}>
        {!tracking && isLoading ? (
          <EmptyState label={t("loading")} />
        ) : !tracking || tracking.recent_transitions.length === 0 ? (
          <EmptyState label={t("transitions.empty")} />
        ) : (
          <TransitionsList rows={tracking.recent_transitions} locale={user.locale} t={t} />
        )}
      </Panel>
    </div>
  );
}

function DegradationBanner({
  carriers,
  t,
}: {
  carriers: CarrierRow[];
  t: CarrierTranslator;
}) {
  const names = carriers.map((c) => c.name || t("unnamedCarrier")).join(", ");
  return (
    <div
      role="alert"
      style={{
        padding: "12px 14px",
        backgroundColor: "#FEF3C7",
        color: "#92400E",
        borderRadius: 6,
        fontSize: 13,
        marginBottom: 16,
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      <TrendingDown size={16} strokeWidth={2} aria-hidden="true" style={{ marginTop: 2 }} />
      <div>
        <div style={{ fontWeight: 600 }}>{t("trends.degradationTitle")}</div>
        <div style={{ marginTop: 2 }}>{t("trends.degradationBody", { names })}</div>
      </div>
    </div>
  );
}

function CarrierCard({
  carrier,
  locale,
  marketCode,
  expanded,
  onToggle,
  t,
}: {
  carrier: CarrierRow;
  locale: string;
  marketCode: string;
  expanded: boolean;
  onToggle: () => void;
  t: CarrierTranslator;
}) {
  const hasStuck = carrier.stuck_count > 0;
  const d30 = carrier.delivery_rates.d30;
  const medianDays =
    carrier.median_transit_hours === null
      ? null
      : carrier.median_transit_hours / 24;

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: 16,
          display: "flex",
          alignItems: "center",
          gap: 14,
          cursor: "pointer",
          textAlign: "start",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 36,
            height: 36,
            borderRadius: 6,
            backgroundColor: "#F1F2F4",
            color: "#1A1A1A",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Truck size={18} strokeWidth={1.5} />
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#1A1A1A" }}>
              {carrier.name || t("unnamedCarrier")}
            </span>
            {carrier.trend_alert && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "2px 8px",
                  backgroundColor: "#FEF3C7",
                  color: "#92400E",
                  borderRadius: 4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <TrendingDown size={12} strokeWidth={2} aria-hidden="true" />
                {t("trends.degrading")}
              </span>
            )}
            {hasStuck && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "2px 8px",
                  backgroundColor: "#FEE2E2",
                  color: "#B91C1C",
                  borderRadius: 4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <AlertTriangle size={12} strokeWidth={2} aria-hidden="true" />
                {t("stuck", { count: carrier.stuck_count })}
              </span>
            )}
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: "#6D7175" }}>
            {t("story", {
              inFlight: carrier.total,
              median:
                medianDays === null ? "—" : medianDays.toFixed(1),
              rate:
                d30 === null ? "—" : Math.round(d30 * 100).toString(),
            })}
          </div>
        </div>

        <span
          aria-hidden="true"
          style={{
            color: "#6D7175",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
          }}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>

      <div
        style={{
          padding: "0 16px 12px",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8,
          borderBlockStart: "1px solid #F1F2F4",
          paddingBlockStart: 10,
          marginInline: 0,
        }}
      >
        {PHASE_2_STATUSES.map((status) => (
          <StatusBucket
            key={status}
            label={t(`status.${status}` as "status.dispatched")}
            count={carrier.by_status[status]}
          />
        ))}
      </div>

      {expanded && (
        <div
          style={{
            borderBlockStart: "1px solid #F1F2F4",
            background: "#FAFBFB",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <DeliveryRatesRow rates={carrier.delivery_rates} t={t} />
          <CostStrip cost={carrier.cost} marketCode={marketCode} t={t} />
          <StuckOrdersTable
            rows={carrier.stuck_orders}
            locale={locale}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

function DeliveryRatesRow({
  rates,
  t,
}: {
  rates: CarrierRow["delivery_rates"];
  t: CarrierTranslator;
}) {
  const cols: Array<{ key: "d7" | "d30" | "d90"; label: string }> = [
    { key: "d7", label: t("rates.d7") },
    { key: "d30", label: t("rates.d30") },
    { key: "d90", label: t("rates.d90") },
  ];
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "#6D7175",
          marginBottom: 6,
        }}
      >
        {t("rates.title")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {cols.map((c) => {
          const v = rates[c.key];
          return (
            <div
              key={c.key}
              style={{
                background: "#FFFFFF",
                border: "1px solid #E1E3E5",
                borderRadius: 6,
                padding: "10px 12px",
              }}
            >
              <div style={{ fontSize: 11, color: "#6D7175" }}>{c.label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: "#1A1A1A" }}>
                {v === null ? "—" : `${Math.round(v * 100)}%`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CostStrip({
  cost,
  marketCode,
  t,
}: {
  cost: CarrierRow["cost"];
  marketCode: string;
  t: CarrierTranslator;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "#6D7175",
          marginBottom: 6,
        }}
      >
        {t("cost.title")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        <KpiTile
          label={t("cost.periodSpend")}
          value={formatCurrency(cost.period_shipping_cost, marketCode)}
        />
        <KpiTile
          label={t("cost.perDelivered")}
          value={
            cost.per_delivered_cost === null
              ? "—"
              : formatCurrency(cost.per_delivered_cost, marketCode)
          }
        />
        <KpiTile
          label={t("cost.delivered")}
          value={String(cost.period_delivered_count)}
        />
      </div>
    </div>
  );
}

function KpiTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 6,
        padding: "10px 12px",
      }}
    >
      <div style={{ fontSize: 11, color: "#6D7175" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "#1A1A1A" }}>{value}</div>
    </div>
  );
}

function StuckOrdersTable({
  rows,
  locale,
  t,
}: {
  rows: CarrierRow["stuck_orders"];
  locale: string;
  t: CarrierTranslator;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "#6D7175",
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Clock size={12} strokeWidth={2} aria-hidden="true" />
        {t("stuckOrders.title")}
      </div>
      {rows.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: "#6D7175",
            padding: "10px 12px",
            background: "#FFFFFF",
            border: "1px solid #E1E3E5",
            borderRadius: 6,
          }}
        >
          {t("stuckOrders.empty")}
        </div>
      ) : (
        <div
          style={{
            background: "#FFFFFF",
            border: "1px solid #E1E3E5",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#FAFBFB" }}>
                <th style={thStyle}>{t("stuckOrders.cols.customer")}</th>
                <th style={thStyle}>{t("stuckOrders.cols.city")}</th>
                <th style={thStyle}>{t("stuckOrders.cols.status")}</th>
                <th style={thStyle}>{t("stuckOrders.cols.lastUpdate")}</th>
                <th style={thStyle}>{t("stuckOrders.cols.age")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBlockStart: "1px solid #F1F2F4" }}>
                  <td style={tdStyle}>
                    <Link
                      href={`/${locale}/orders/${r.id}`}
                      style={{ color: "#1A1A1A", textDecoration: "none", fontWeight: 500 }}
                    >
                      {r.customer_name || t("unknownCustomer")}
                    </Link>
                  </td>
                  <td style={tdStyle}>{r.customer_city || "—"}</td>
                  <td style={tdStyle}>
                    <span style={{ color: "#6D7175" }}>
                      {t(`status.${r.status}` as "status.dispatched")}
                    </span>
                  </td>
                  <td style={tdStyle}>{formatExactTime(r.last_update, locale)}</td>
                  <td style={tdStyle}>
                    <span style={{ color: r.age_hours >= 24 * 5 ? "#B91C1C" : "#92400E", fontWeight: 500 }}>
                      {t("stuckOrders.ageHours", { hours: r.age_hours })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "start",
  padding: "8px 12px",
  fontSize: 11,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  color: "#1A1A1A",
  verticalAlign: "middle",
};

function StatusBucket({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
      <span style={{ fontSize: 16, fontWeight: 600, color: count > 0 ? "#1A1A1A" : "#C9CCCF" }}>
        {count}
      </span>
      <span
        style={{
          fontSize: 10,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          textAlign: "center",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function TransitionsList({
  rows,
  locale,
  t,
}: {
  rows: Array<{
    id: string;
    order_id: string;
    customer_name: string;
    carrier_name: string;
    status_from: string | null;
    status_to: string;
    created_at: string;
  }>;
  locale: string;
  t: CarrierTranslator;
}) {
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r) => (
        <li key={r.id}>
          <Link
            href={`/${locale}/orders/${r.order_id}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 10px",
              border: "1px solid #E1E3E5",
              borderRadius: 6,
              textDecoration: "none",
              color: "#1A1A1A",
            }}
          >
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {r.customer_name || t("unknownCustomer")}
              <span style={{ fontWeight: 400, color: "#6D7175", marginInlineStart: 8 }}>
                · {r.carrier_name || t("unnamedCarrier")}
              </span>
            </span>
            <span style={{ fontSize: 11, color: "#6D7175", whiteSpace: "nowrap" }}>
              {r.status_from ?? "—"} → <strong style={{ color: "#1A1A1A" }}>{r.status_to}</strong>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { FilterBar, type Period, type PeriodPreset } from "@/components/dashboard/FilterBar";
import { periodDeltaProps } from "@/components/dashboard/PeriodDeltaBadge";
import { todayISO, startOfMonthISO, computePreviousPeriod } from "@/lib/date";
import { formatCurrency as formatMarketCurrency } from "@/lib/format";
import { TONE_COLOR, formatPct, type Tone } from "@/components/dashboard/kpiDelta";
import {
  calculatePeriodDelta,
  calculateMarginDelta,
} from "@/lib/calculations/deltas";
import type { AuthUser } from "@/types";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface PreviousData {
  revenue: number;
  net_profit: number;
  margin: number;
  ad_spend: number;
  confirmed_count: number;
  delivered_count: number;
  leads_count: number;
  cpa: number | null;
  cpl: number | null;
  period: { from_date: string; to_date: string };
}

interface ProfitabilityData {
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  ad_spend: number;
  net_profit: number;
  margin: number;
  delivered_count: number;
  returned_count: number;
  confirmed_count: number;
  leads_count: number;
  cpa: number | null;
  cpl: number | null;
  previous: PreviousData | null;
}

export function ProfitabilityClient({
  user,
  markets,
  initialMarketId,
}: {
  user: AuthUser;
  markets: Market[];
  initialMarketId: string;
}) {
  const t = useTranslations("pnl");
  const tNav = useTranslations("dashboard.filters");
  const isSuperAdmin = user.role === "super_admin";

  const [period, setPeriod] = useState<Period>({
    from_date: startOfMonthISO(),
    to_date: todayISO(),
  });
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [selectedMarketId, setSelectedMarketId] = useState<string>(
    isSuperAdmin ? initialMarketId : user.market_id ?? "",
  );

  const effectiveMarketId = isSuperAdmin ? selectedMarketId : user.market_id ?? "";
  const marketCode = useMemo(() => {
    const m = markets.find((x) => x.id === effectiveMarketId);
    return (m?.code ?? "tn").toUpperCase();
  }, [markets, effectiveMarketId]);

  const previousPeriod = useMemo(
    () => computePreviousPeriod(period.from_date, period.to_date),
    [period.from_date, period.to_date],
  );

  const swrKey = useMemo(() => {
    if (!effectiveMarketId) return null;
    const params = new URLSearchParams({
      from_date: period.from_date,
      to_date: period.to_date,
      market_id: effectiveMarketId,
      previous_from_date: previousPeriod.from_date,
      previous_to_date: previousPeriod.to_date,
    });
    return `/api/profitability?${params.toString()}`;
  }, [
    period.from_date,
    period.to_date,
    effectiveMarketId,
    previousPeriod.from_date,
    previousPeriod.to_date,
  ]);

  const { data, isLoading, error } = useSWR<{ data: ProfitabilityData }>(swrKey, {
    refreshInterval: 120_000,
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  const pnl = data?.data ?? null;

  const marketLabel =
    markets.find((m) => m.id === effectiveMarketId)?.name ??
    (isSuperAdmin ? tNav("marketPlaceholder") : "");

  const deltas = useMemo(() => {
    if (!pnl?.previous) return null;
    const prev = pnl.previous;
    return {
      revenue: calculatePeriodDelta(pnl.revenue, prev.revenue),
      netProfit: calculatePeriodDelta(pnl.net_profit, prev.net_profit),
      marginPP: calculateMarginDelta(pnl.margin / 100, prev.margin / 100),
      adSpend: calculatePeriodDelta(pnl.ad_spend, prev.ad_spend),
      cpa: pnl.cpa != null && prev.cpa != null ? calculatePeriodDelta(pnl.cpa, prev.cpa) : null,
      cpl: pnl.cpl != null && prev.cpl != null ? calculatePeriodDelta(pnl.cpl, prev.cpl) : null,
    };
  }, [pnl]);

  return (
    <div style={{ backgroundColor: "#F6F6F7", minHeight: "100vh", padding: "20px 24px 40px" }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: "#1A1A1A", margin: 0, letterSpacing: "-0.01em" }}>
            {t("title")}
          </h1>
          <span style={{ fontSize: 12, color: "#6D7175" }}>{t("subtitle")}</span>
        </div>
      </header>

      <div style={{ marginBottom: 10 }}>
        <FilterBar
          period={period}
          activePreset={preset}
          onPeriodChange={(p, preset) => {
            setPeriod(p);
            setPreset(preset);
          }}
          markets={markets}
          selectedMarketId={effectiveMarketId || null}
          onMarketChange={(id) => setSelectedMarketId(id === "all" ? initialMarketId : id)}
          allowAllMarkets={false}
          lockMarket={!isSuperAdmin}
          lockedMarketLabel={marketLabel}
          labels={{
            today: tNav("today"),
            week: tNav("week"),
            month: tNav("month"),
            custom: tNav("custom"),
            allMarkets: tNav("allMarkets"),
            marketPlaceholder: tNav("marketPlaceholder"),
            lastUpdated: tNav("lastUpdated"),
          }}
        />
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            backgroundColor: "#FEE2E2",
            color: "#B91C1C",
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 10,
          }}
        >
          {t("loadError")}
        </div>
      )}

      {/* Dense KPI strip — 6 columns on wide screens, wraps to 3×2 on medium */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
          gap: 1,
          background: "#E1E3E5",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          overflow: "hidden",
          marginBottom: 10,
        }}
      >
        <KpiCell
          label={t("kpi.revenue")}
          value={formatCurrency(pnl?.revenue, isLoading, marketCode)}
          subtitle={pnl ? t("kpi.deliveredCount", { count: pnl.delivered_count }) : null}
          {...periodDeltaProps(deltas?.revenue ?? null)}
        />
        <KpiCell
          label={t("kpi.netProfit")}
          value={formatCurrency(pnl?.net_profit, isLoading, marketCode)}
          subtitle={pnl ? `${pnl.margin.toFixed(1)}% ${t("kpi.margin").toLowerCase()}` : null}
          emphatic={pnl != null}
          valueTone={pnl != null && pnl.net_profit < 0 ? "critical" : "default"}
          {...periodDeltaProps(deltas?.netProfit ?? null)}
        />
        <KpiCell
          label={t("kpi.margin")}
          value={pnl != null ? formatPct(pnl.margin) : "—"}
          subtitle={pnl?.previous ? `${pnl.previous.margin.toFixed(1)}% ${t("kpi.prevShort")}` : null}
          deltaText={deltas?.marginPP != null ? formatPP(deltas.marginPP) : "—"}
          deltaTone={
            deltas?.marginPP == null
              ? "neutral"
              : deltas.marginPP > 0
                ? "success"
                : deltas.marginPP < 0
                  ? "critical"
                  : "neutral"
          }
        />
        <KpiCell
          label={t("kpi.adSpend")}
          value={formatCurrency(pnl?.ad_spend, isLoading, marketCode)}
          subtitle={pnl ? `${pnl.leads_count} ${t("kpi.leadsShort")}` : null}
          {...periodDeltaProps(deltas?.adSpend ?? null, { invert: true })}
        />
        <KpiCell
          label={t("kpi.cpa")}
          value={formatCurrencyOrDash(pnl?.cpa, isLoading, marketCode)}
          subtitle={pnl ? `${pnl.confirmed_count} ${t("kpi.confirmedShort")}` : null}
          {...periodDeltaProps(deltas?.cpa ?? null, { invert: true })}
        />
        <KpiCell
          label={t("kpi.cpl")}
          value={formatCurrencyOrDash(pnl?.cpl, isLoading, marketCode)}
          subtitle={pnl ? `${pnl.leads_count} ${t("kpi.leadsShort")}` : null}
          {...periodDeltaProps(deltas?.cpl ?? null, { invert: true })}
        />
      </div>

      {/* Dense 2-column: breakdown table on left, operational counters on right */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
          gap: 10,
        }}
      >
        <DenseCard title={t("breakdown.title")}>
          {pnl ? (
            <CostBreakdownTable pnl={pnl} t={t} marketCode={marketCode} />
          ) : (
            <DenseEmpty label={isLoading ? t("loading") : t("noData")} />
          )}
        </DenseCard>

        <DenseCard title={t("operational.title")}>
          {pnl ? (
            <OperationalStats pnl={pnl} t={t} marketCode={marketCode} />
          ) : (
            <DenseEmpty label={isLoading ? t("loading") : t("noData")} />
          )}
        </DenseCard>
      </div>
    </div>
  );
}

// ---------- Dense UI primitives ----------

function KpiCell({
  label,
  value,
  subtitle,
  deltaText,
  deltaTone = "neutral",
  emphatic = false,
  valueTone = "default",
}: {
  label: string;
  value: string;
  subtitle?: string | null;
  deltaText?: string | null;
  deltaTone?: Tone;
  emphatic?: boolean;
  valueTone?: "default" | "critical";
}) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minHeight: 74,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          lineHeight: 1.2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 2,
        }}
      >
        <span
          style={{
            fontSize: emphatic ? 18 : 16,
            fontWeight: 700,
            color: valueTone === "critical" ? "#D72C0D" : "#1A1A1A",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {value}
        </span>
        {deltaText ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: TONE_COLOR[deltaTone],
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {deltaText}
          </span>
        ) : null}
      </div>
      {subtitle ? (
        <div
          style={{
            fontSize: 11,
            color: "#6D7175",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}

function DenseCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: "10px 12px 12px",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#6D7175",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function DenseEmpty({ label }: { label: string }) {
  return (
    <div style={{ padding: "24px 0", textAlign: "center", fontSize: 12, color: "#6D7175" }}>
      {label}
    </div>
  );
}

// ---------- Content ----------

type PnLTranslator = ReturnType<typeof useTranslations<"pnl">>;

function CostBreakdownTable({
  pnl,
  t,
  marketCode,
}: {
  pnl: ProfitabilityData;
  t: PnLTranslator;
  marketCode: string;
}) {
  const rows: { key: string; value: number; tone: "add" | "sub" | "net"; pctOfRev: number }[] = [
    { key: "revenue", value: pnl.revenue, tone: "add", pctOfRev: 100 },
    { key: "cogs", value: -pnl.cogs, tone: "sub", pctOfRev: pct(pnl.cogs, pnl.revenue) },
    { key: "delivery", value: -pnl.delivery_cost, tone: "sub", pctOfRev: pct(pnl.delivery_cost, pnl.revenue) },
    { key: "returns", value: -pnl.return_cost, tone: "sub", pctOfRev: pct(pnl.return_cost, pnl.revenue) },
    { key: "packing", value: -pnl.packing_cost, tone: "sub", pctOfRev: pct(pnl.packing_cost, pnl.revenue) },
    { key: "ads", value: -pnl.ad_spend, tone: "sub", pctOfRev: pct(pnl.ad_spend, pnl.revenue) },
    { key: "netProfit", value: pnl.net_profit, tone: "net", pctOfRev: pct(pnl.net_profit, pnl.revenue) },
  ];

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
      <tbody>
        {rows.map((row, idx) => {
          const isNet = row.tone === "net";
          const isNegativeNet = isNet && row.value < 0;
          return (
            <tr
              key={row.key}
              style={{
                borderTop: isNet ? "2px solid #1A1A1A" : idx === 0 ? "none" : "1px solid #F1F2F4",
              }}
            >
              <td
                style={{
                  padding: "6px 0",
                  fontWeight: isNet ? 600 : 400,
                  color: "#1A1A1A",
                  width: "auto",
                }}
              >
                {t(`breakdown.rows.${row.key}` as "breakdown.rows.revenue")}
              </td>
              <td
                style={{
                  padding: "6px 8px",
                  textAlign: "right",
                  color: "#6D7175",
                  fontSize: 11,
                  width: 60,
                }}
              >
                {row.pctOfRev != null ? `${row.pctOfRev.toFixed(1)}%` : ""}
              </td>
              <td
                style={{
                  padding: "6px 0",
                  textAlign: "right",
                  fontWeight: isNet ? 700 : 500,
                  color:
                    row.tone === "sub"
                      ? "#6D7175"
                      : isNegativeNet
                        ? "#D72C0D"
                        : "#1A1A1A",
                  width: 140,
                }}
              >
                {formatMarketCurrency(row.value, marketCode)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OperationalStats({
  pnl,
  t,
  marketCode,
}: {
  pnl: ProfitabilityData;
  t: PnLTranslator;
  marketCode: string;
}) {
  const deliveryRate = pnl.confirmed_count > 0
    ? (pnl.delivered_count / pnl.confirmed_count) * 100
    : 0;
  const returnRate = pnl.delivered_count + pnl.returned_count > 0
    ? (pnl.returned_count / (pnl.delivered_count + pnl.returned_count)) * 100
    : 0;
  const confirmationRate = pnl.leads_count > 0
    ? (pnl.confirmed_count / pnl.leads_count) * 100
    : 0;
  const aov = pnl.delivered_count > 0 ? pnl.revenue / pnl.delivered_count : 0;
  const profitPerDelivered = pnl.delivered_count > 0 ? pnl.net_profit / pnl.delivered_count : 0;

  const rows: { label: string; value: string; tone?: "critical" }[] = [
    { label: t("operational.leads"), value: pnl.leads_count.toLocaleString() },
    { label: t("operational.confirmed"), value: pnl.confirmed_count.toLocaleString() },
    { label: t("operational.delivered"), value: pnl.delivered_count.toLocaleString() },
    { label: t("operational.returned"), value: pnl.returned_count.toLocaleString() },
    { label: t("operational.confirmationRate"), value: `${confirmationRate.toFixed(1)}%` },
    { label: t("operational.deliveryRate"), value: `${deliveryRate.toFixed(1)}%` },
    { label: t("operational.returnRate"), value: `${returnRate.toFixed(1)}%`, tone: returnRate > 15 ? "critical" : undefined },
    { label: t("operational.aov"), value: formatMarketCurrency(aov, marketCode) },
    { label: t("operational.profitPerDelivered"), value: formatMarketCurrency(profitPerDelivered, marketCode), tone: profitPerDelivered < 0 ? "critical" : undefined },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 8,
            padding: "4px 0",
            borderBottom: "1px solid #F6F6F7",
            fontSize: 12,
          }}
        >
          <span style={{ color: "#6D7175" }}>{row.label}</span>
          <span
            style={{
              fontWeight: 600,
              color: row.tone === "critical" ? "#D72C0D" : "#1A1A1A",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Helpers ----------

function formatCurrency(value: number | undefined, loading: boolean, marketCode: string): string {
  if (value === undefined) return loading ? "—" : "—";
  return formatMarketCurrency(value, marketCode);
}

function formatCurrencyOrDash(
  value: number | null | undefined,
  loading: boolean,
  marketCode: string,
): string {
  if (value === null) return "—";
  if (value === undefined) return loading ? "—" : "—";
  return formatMarketCurrency(value, marketCode);
}

function formatPP(pp: number): string {
  const sign = pp > 0 ? "+" : "";
  return `${sign}${pp.toFixed(1)} pp`;
}

function pct(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

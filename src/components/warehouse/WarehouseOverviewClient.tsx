"use client";

import { useMemo, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Printer, ScanLine, RotateCcw, AlertTriangle } from "lucide-react";
import { WarehouseKpiStrip } from "./WarehouseKpiStrip";
import { useWarehouseSummary } from "@/hooks/useWarehouseSummary";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { useIsMobile } from "@/hooks/useIsMobile";
import { canViewProfitability } from "@/lib/role-permissions";
import type { WarehouseSummary } from "@/lib/warehouse/summary";
import type { AuthUser } from "@/types";

const WarehouseTrendChart = dynamic(
  () =>
    import("./WarehouseTrendChart").then((m) => m.WarehouseTrendChart),
  { ssr: false, loading: () => <ChartSkeleton height={240} /> },
);

const D = {
  pageBg:   "#061A1C",
  cardBg:   "#02090A",
  border:   "#1E2C31",
  shadow:   "0 0 0 1px rgba(0,0,0,0.1), 0 2px 2px rgba(0,0,0,0.1), 0 4px 4px rgba(0,0,0,0.1), 0 8px 8px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.03)",
  white:    "#FFFFFF",
  muted:    "#A1A1AA",
  tertiary: "#71717A",
  accent:   "#36F4A4",
  warning:  "#F5C563",
  danger:   "#F47272",
  info:     "#7FB8F5",
} as const;

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      style={{
        height,
        background: "#0D2224",
        borderRadius: 8,
        animation: "pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

function DarkPanel({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        background: D.cardBg,
        border: `1px solid ${D.border}`,
        borderRadius: 12,
        padding: 20,
        boxShadow: D.shadow,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            color: D.white,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </h2>
        {action ?? null}
      </div>
      {children}
    </div>
  );
}

function DarkEmptyState({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 160,
        fontSize: 13,
        color: D.tertiary,
      }}
    >
      {label}
    </div>
  );
}

interface Props {
  user: AuthUser;
  locale: string;
  initialSummary: WarehouseSummary;
  initialMarketId: string | "all" | null;
}

export function WarehouseOverviewClient({
  user,
  locale,
  initialSummary,
  initialMarketId,
}: Props) {
  const t = useTranslations("warehouse");
  const isSuperAdmin = canViewProfitability(user.role);
  const isMobile = useIsMobile();

  const [selectedMarketId, setSelectedMarketId] = useState<string | "all">(
    isSuperAdmin ? (initialMarketId ?? "all") : (user.market_id ?? ""),
  );
  const [hoveredAction, setHoveredAction] = useState<number | null>(null);

  const { summary, isLoading, mutate } = useWarehouseSummary({
    marketId: isSuperAdmin ? selectedMarketId : user.market_id,
    initialSummary,
    initialMarketId,
  });

  useWarehouseRealtime({
    marketId:
      isSuperAdmin && selectedMarketId !== "all"
        ? selectedMarketId
        : isSuperAdmin
          ? null
          : user.market_id,
    page: "overview",
    onRefresh: mutate,
  });

  const current = summary ?? initialSummary;
  const activityRows = current.activity.slice(0, 8);

  const quickActions = useMemo(() => [
    {
      label: t("overview.goToLabel"),
      icon: <Printer size={18} strokeWidth={1.5} />,
      href: `/${locale}/warehouse/to-label`,
    },
    {
      label: t("overview.goToScan"),
      icon: <ScanLine size={18} strokeWidth={1.5} />,
      href: `/${locale}/warehouse/to-scan`,
    },
    {
      label: t("overview.goToReturns"),
      icon: <RotateCcw size={18} strokeWidth={1.5} />,
      href: `/${locale}/warehouse/to-scan`,
    },
  ], [locale, t]);

  return (
    <div
      style={{
        padding: isMobile ? "16px 16px 48px" : "32px 32px 64px",
        background: D.pageBg,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: isMobile ? 16 : 24,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
          <h1
            style={{
              fontSize: isMobile ? 22 : 28,
              fontWeight: 700,
              color: D.white,
              margin: 0,
              letterSpacing: "-0.02em",
            }}
          >
            {t("overview.title")}
          </h1>
          {isLoading && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: D.accent,
                background: "rgba(54,244,164,0.1)",
                borderRadius: 9999,
                padding: "3px 10px",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              {t("overview.refreshing")}
            </span>
          )}
        </div>
        <p style={{ fontSize: 13, color: D.muted, margin: 0 }}>
          {t("overview.subtitle")}
        </p>

        {isSuperAdmin && current.availableMarkets.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <select
              value={selectedMarketId}
              onChange={(e) =>
                setSelectedMarketId(e.target.value as string | "all")
              }
              style={{
                padding: "8px 12px",
                background: D.cardBg,
                border: `1px solid ${D.border}`,
                borderRadius: 8,
                color: D.white,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                minWidth: 180,
              }}
            >
              <option value="all">{t("filters.allMarkets")}</option>
              {current.availableMarkets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <WarehouseKpiStrip
        kpis={current.kpis}
        trend={current.trend}
        locale={locale}
        isMobile={isMobile}
        labels={{
          pendingLabels: t("overview.pendingLabels"),
          toScanOut: t("overview.toScanOut"),
          returnsInbox: t("overview.returnsInbox"),
          damagedWeek: t("overview.damagedWeek"),
          vsLastWeek: t("overview.vsLastWeek"),
          goToLabel: t("overview.goToLabel"),
          goToScan: t("overview.goToScan"),
          goToReturns: t("overview.goToReturns"),
          goToHistory: t("overview.goToHistory"),
        }}
      />

      {current.lowStock.length > 0 && (
        <div
          style={{
            background: "rgba(245,197,99,0.05)",
            border: "1px solid rgba(245,197,99,0.25)",
            borderRadius: 12,
            padding: "16px 20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={16} strokeWidth={1.5} color={D.warning} />
            <h2
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: D.warning,
              }}
            >
              {t("overview.lowStockTitle")}
            </h2>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              flexWrap: isMobile ? "nowrap" : "wrap",
              overflowX: isMobile ? "auto" : "visible",
              gap: 8,
              marginTop: 12,
            }}
          >
            {current.lowStock.map((p) => {
              const isCritical = p.current_stock <= 0;
              return (
                <span
                  key={p.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 9999,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    background: isCritical
                      ? "rgba(244,114,114,0.08)"
                      : "rgba(245,197,99,0.08)",
                    border: `1px solid ${isCritical ? "rgba(244,114,114,0.2)" : "rgba(245,197,99,0.2)"}`,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 500, color: D.white }}>
                    {p.name}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: isCritical ? D.danger : D.warning,
                    }}
                  >
                    {p.current_stock}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
          gap: 12,
        }}
      >
        {quickActions.map((action, idx) => {
          const isHovered = hoveredAction === idx;
          return (
            <Link
              key={`${action.href}-${idx}`}
              href={action.href}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                padding: "14px 20px",
                minHeight: 52,
                background: D.cardBg,
                border: `1px solid ${isHovered ? D.accent : D.border}`,
                borderRadius: 9999,
                boxShadow: D.shadow,
                color: D.white,
                fontSize: 15,
                fontWeight: 600,
                textDecoration: "none",
                transition: "border-color 150ms ease",
              }}
              onMouseEnter={() => setHoveredAction(idx)}
              onMouseLeave={() => setHoveredAction(null)}
            >
              {action.icon}
              {action.label}
            </Link>
          );
        })}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile
            ? "1fr"
            : "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <DarkPanel title={t("overview.trendTitle")}>
          {current.trend.length > 0 ? (
            <WarehouseTrendChart
              data={current.trend}
              colorScheme="dark"
              labels={{
                scanned: t("overview.trendScanned"),
                returned: t("overview.trendReturned"),
                damaged: t("overview.trendDamaged"),
              }}
            />
          ) : (
            <DarkEmptyState label={t("history.empty")} />
          )}
        </DarkPanel>

        <DarkPanel
          title={t("activity.title")}
          action={
            !isMobile ? (
              <Link
                href={`/${locale}/warehouse/history`}
                style={{
                  fontSize: 12,
                  color: D.tertiary,
                  textDecoration: "none",
                  fontWeight: 500,
                  flexShrink: 0,
                }}
              >
                {t("overview.goToHistory")} →
              </Link>
            ) : undefined
          }
        >
          {activityRows.length === 0 ? (
            <DarkEmptyState label={t("history.empty")} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {activityRows.map((e) => {
                const kindColor =
                  e.kind === "scan"
                    ? D.accent
                    : e.kind === "return"
                      ? e.is_damaged
                        ? D.danger
                        : D.muted
                      : D.info;

                return (
                  <div
                    key={`${e.kind}-${e.id}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "80px 1fr 60px",
                      gap: 8,
                      padding: "10px 0",
                      borderBottom: `1px solid ${D.border}`,
                      alignItems: "center",
                      minHeight: isMobile ? 44 : undefined,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.07em",
                        textTransform: "uppercase",
                        color: kindColor,
                        background: `${kindColor}18`,
                        borderRadius: 6,
                        padding: "2px 6px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t(`history.kind.${e.kind}`)}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        color: D.muted,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {e.detail}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: D.tertiary,
                        textAlign: "end",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {new Date(e.at).toLocaleTimeString(
                        locale === "ar" ? "ar" : locale,
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </span>
                  </div>
                );
              })}
              <div style={{ marginTop: 14 }}>
                <Link
                  href={`/${locale}/warehouse/history`}
                  style={{
                    fontSize: 13,
                    color: D.muted,
                    textDecoration: "none",
                    fontWeight: 500,
                  }}
                >
                  {t("overview.goToHistory")} →
                </Link>
              </div>
            </div>
          )}
        </DarkPanel>
      </div>
    </div>
  );
}

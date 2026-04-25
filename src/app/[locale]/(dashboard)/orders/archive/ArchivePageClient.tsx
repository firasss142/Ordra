"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { Locale, Role } from "@/types";
import { fetcher } from "@/lib/swr-config";
import { useOrdersList } from "@/hooks/useOrdersList";
import { DEFAULT_FILTERS, type OrderListFilters } from "@/lib/orders/list-filters";
import { REJECTION_REASONS, TERMINAL_STATUSES, type OrderStatus, type RejectionReason } from "@/types/order-status";
import { todayISO } from "@/lib/date";
import { OrdersTable } from "@/components/orders/OrdersTable";

const OrderDetailPanel = dynamic(
  () => import("@/components/queue/OrderDetailPanel").then((m) => m.OrderDetailPanel),
  { ssr: false },
);

interface Market { id: string; name: string; code: string; currency?: string }

interface Props {
  role: Role;
  locale: Locale;
  userMarketId: string;
  userMarketLabel: string;
  userMarketCurrency: string;
  initialMarketId: string;
}

type OutcomeKey = "delivered" | "returned" | "rejected" | "cancelled";
const OUTCOME_KEYS: OutcomeKey[] = ["delivered", "returned", "rejected", "cancelled"];

interface ArchiveSummary {
  total: number;
  outcomes: Record<OutcomeKey, number>;
  rejectionReasons: Record<RejectionReason, number>;
  topReturnedProducts: Array<{ product_id: string; product_name: string; count: number }>;
  topReturnCities: Array<{ city: string; count: number }>;
  topReturnCarriers: Array<{ carrier_id: string; count: number }>;
  cohorts: Array<{ week: string; delivered: number; returned: number; rejected: number; cancelled: number }>;
}

const OUTCOME_COLORS: Record<OutcomeKey, { bg: string; fg: string }> = {
  delivered: { bg: "#E3F1DF", fg: "#116530" },
  returned:  { bg: "#FFF1E6", fg: "#8A4B00" },
  rejected:  { bg: "#FFF4F4", fg: "#D72C0D" },
  cancelled: { bg: "#F1F1F1", fg: "#6D7175" },
};

function pct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((part / total) * 1000) / 10}%`;
}

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: todayISO() };
}

export function ArchivePageClient({
  role,
  locale,
  userMarketId,
  userMarketLabel,
  userMarketCurrency,
  initialMarketId,
}: Props) {
  const t = useTranslations("orders.archive");
  const tStatus = useTranslations("orders.statuses");
  const tReason = useTranslations("orders.rejectionReasons");
  const isSuperAdmin = role === "super_admin";

  const initial = defaultDateRange();
  const [fromDate, setFromDate] = useState(initial.from);
  const [toDate, setToDate] = useState(initial.to);
  const [marketId, setMarketId] = useState<string>(
    isSuperAdmin ? initialMarketId : userMarketId,
  );
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeKey[]>([]);
  const [reasonFilter, setReasonFilter] = useState<RejectionReason | "">("");

  // Debounce: searchInput updates on every keystroke; search (used in filters) updates 300ms later
  useEffect(() => {
    const h = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(h);
  }, [searchInput]);

  const effectiveStatuses: OrderStatus[] =
    outcomeFilter.length > 0 ? (outcomeFilter as OrderStatus[]) : TERMINAL_STATUSES;

  const filters: OrderListFilters = useMemo(
    () => ({
      ...DEFAULT_FILTERS,
      marketId: marketId || null,
      statuses: effectiveStatuses,
      q: search,
      dateFrom: fromDate,
      dateTo: toDate,
      rejectionReason: reasonFilter || null,
    }),
    [marketId, effectiveStatuses, search, fromDate, toDate, reasonFilter],
  );

  const { data: marketsData } = useSWR<{ data: Market[] }>(
    isSuperAdmin ? "/api/markets" : null,
    fetcher,
  );
  const markets = marketsData?.data ?? [];

  const currencyCode = useMemo(() => {
    if (isSuperAdmin) {
      const m = markets.find((m) => m.id === marketId);
      return m?.currency ?? userMarketCurrency;
    }
    return userMarketCurrency;
  }, [isSuperAdmin, markets, marketId, userMarketCurrency]);

  const summaryKey = useMemo(() => {
    if (!marketId) return null;
    const params = new URLSearchParams({ market_id: marketId, from_date: fromDate, to_date: toDate });
    if (outcomeFilter.length) params.set("status", outcomeFilter.join(","));
    return `/api/orders/archive/summary?${params.toString()}`;
  }, [marketId, fromDate, toDate, outcomeFilter]);

  const { data: summaryRes, isLoading: summaryLoading } = useSWR<{ data: ArchiveSummary }>(
    summaryKey,
    fetcher,
    { revalidateOnFocus: false },
  );
  const summary = summaryRes?.data;

  const {
    rows,
    isLoading: listLoading,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
    currentPage,
  } = useOrdersList({ filters });

  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const handleExport = useCallback(() => {
    const params = new URLSearchParams();
    params.set("market_id", marketId);
    params.set("status", (outcomeFilter.length ? outcomeFilter : OUTCOME_KEYS).join(","));
    if (search) params.set("q", search);
    if (fromDate) params.set("date_from", fromDate);
    if (toDate) params.set("date_to", toDate);
    if (reasonFilter) params.set("rejection_reason", reasonFilter);
    window.location.href = `/api/orders/export?${params.toString()}`;
  }, [marketId, outcomeFilter, search, fromDate, toDate, reasonFilter]);

  const toggleOutcome = useCallback((k: OutcomeKey) =>
    setOutcomeFilter((prev) =>
      prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
    ), []);

  const activeMarketLabel = useMemo(() => {
    if (!isSuperAdmin) return userMarketLabel;
    return markets.find((m) => m.id === marketId)?.name ?? "—";
  }, [isSuperAdmin, markets, marketId, userMarketLabel]);

  const totalInPeriod = summary?.total ?? 0;

  return (
    <div style={{
      padding: "32px 32px 64px",
      background: "#F6F6F7",
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      gap: 20,
    }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
          {t("subtitle", { market: activeMarketLabel, count: totalInPeriod })}
        </p>
      </div>

      {/* Search bar — primary archive entry point */}
      <div style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchAria")}
            style={{
              flex: "1 1 320px",
              minWidth: 240,
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #E1E3E5",
              background: "#FAFAFA",
              fontSize: 14,
              color: "#1A1A1A",
              outline: "none",
            }}
          />
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label={t("dateFromAria")}
            style={dateInputStyle}
          />
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label={t("dateToAria")}
            style={dateInputStyle}
          />
          {isSuperAdmin ? (
            <select
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
              aria-label={t("marketAria")}
              style={dateInputStyle}
            >
              {markets.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            onClick={handleExport}
            style={{
              padding: "10px 16px",
              borderRadius: 8,
              border: "1px solid #1A1A1A",
              background: "#1A1A1A",
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            {t("exportCsv")}
          </button>
        </div>
      </div>

      {/* Outcome distribution — click to filter results */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>{t("outcomeDistribution")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {OUTCOME_KEYS.map((k) => {
            const count = summary?.outcomes[k] ?? 0;
            const color = OUTCOME_COLORS[k];
            const active = outcomeFilter.includes(k);
            return (
              <button
                key={k}
                onClick={() => toggleOutcome(k)}
                type="button"
                aria-pressed={active}
                style={{
                  textAlign: "start",
                  padding: 16,
                  borderRadius: 8,
                  border: active ? "2px solid #1A1A1A" : "1px solid #E1E3E5",
                  background: "#FFFFFF",
                  cursor: "pointer",
                }}
              >
                <div style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 500,
                  background: color.bg,
                  color: color.fg,
                  marginBottom: 8,
                }}>
                  {tStatus(k)}
                </div>
                <div style={{ fontSize: 24, fontWeight: 600, color: "#1A1A1A" }}>
                  {count.toLocaleString(locale === "ar" ? "ar" : "fr-FR")}
                </div>
                <div style={{ fontSize: 12, color: "#6D7175" }}>
                  {pct(count, totalInPeriod)} {t("ofTotal")}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Rejection reasons — click to scope results to that reason */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>{t("rejectionBreakdown")}</h2>
        {summary && REJECTION_REASONS.some((r) => summary.rejectionReasons[r] > 0) ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {REJECTION_REASONS.map((r) => {
              const count = summary.rejectionReasons[r] ?? 0;
              if (count === 0) return null;
              const active = reasonFilter === r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setOutcomeFilter(["rejected"]);
                    setReasonFilter(active ? "" : r);
                  }}
                  aria-pressed={active}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: active ? "2px solid #1A1A1A" : "1px solid #E1E3E5",
                    background: "#FFFFFF",
                    fontSize: 13,
                    color: "#1A1A1A",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span>{tReason(r)}</span>
                  <span style={{
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "#F1F1F1",
                    color: "#1A1A1A",
                    fontSize: 11,
                    fontWeight: 500,
                  }}>{count}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p style={emptyTextStyle}>{summaryLoading ? t("loading") : t("noRejections")}</p>
        )}
      </section>

      {/* Return investigation — top products / cities / carriers by return volume */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>{t("returnInvestigation")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          <TopList
            title={t("topReturnedProducts")}
            empty={t("noReturns")}
            items={
              summary?.topReturnedProducts.map((p) => ({
                key: p.product_id,
                label: p.product_name || p.product_id,
                count: p.count,
              })) ?? []
            }
          />
          <TopList
            title={t("topReturnCities")}
            empty={t("noReturns")}
            items={
              summary?.topReturnCities.map((c) => ({
                key: c.city,
                label: c.city,
                count: c.count,
              })) ?? []
            }
          />
          <TopList
            title={t("topReturnCarriers")}
            empty={t("noReturns")}
            items={
              summary?.topReturnCarriers.map((c) => ({
                key: c.carrier_id,
                label: c.carrier_id,
                count: c.count,
              })) ?? []
            }
          />
        </div>
      </section>

      {/* Weekly cohort table */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>{t("cohortsWeekly")}</h2>
        {summary && summary.cohorts.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "start", color: "#6D7175" }}>
                  <th style={thStyle}>{t("week")}</th>
                  <th style={thStyle}>{tStatus("delivered")}</th>
                  <th style={thStyle}>{tStatus("returned")}</th>
                  <th style={thStyle}>{tStatus("rejected")}</th>
                  <th style={thStyle}>{tStatus("cancelled")}</th>
                  <th style={thStyle}>{t("total")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.cohorts.map((c) => {
                  const total = c.delivered + c.returned + c.rejected + c.cancelled;
                  return (
                    <tr key={c.week} style={{ borderTop: "1px solid #F1F1F1" }}>
                      <td style={tdStyle}>{c.week}</td>
                      <td style={tdStyle}>{c.delivered}</td>
                      <td style={tdStyle}>{c.returned}</td>
                      <td style={tdStyle}>{c.rejected}</td>
                      <td style={tdStyle}>{c.cancelled}</td>
                      <td style={{ ...tdStyle, fontWeight: 500 }}>{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={emptyTextStyle}>{summaryLoading ? t("loading") : t("noData")}</p>
        )}
      </section>

      {/* Paginated order rows matching current filters */}
      <section style={sectionStyle}>
        <h2 style={sectionTitleStyle}>
          {t("results", { count: rows.length })}
        </h2>
        <OrdersTable
          rows={rows}
          locale={locale}
          currencyCode={currencyCode}
          agents={[]}
          selectedIds={new Set()}
          highlightedIds={new Set()}
          cancellingId={null}
          hasNext={hasNext}
          hasPrev={hasPrev}
          currentPage={currentPage}
          onNextPage={nextPage}
          onPrevPage={prevPage}
          onOpen={(id) => setOpenOrderId(id)}
          onToggleSelect={() => {}}
          onToggleSelectAll={() => {}}
          onCancel={() => {}}
          isLoading={listLoading}
          isEmpty={!listLoading && rows.length === 0}
        />
      </section>

      <OrderDetailPanel
        key={openOrderId ?? "none"}
        orderId={openOrderId}
        fallbackOrder={null}
        onClose={() => setOpenOrderId(null)}
        onCallTerminated={() => setOpenOrderId(null)}
        onReturnToPool={undefined}
      />
    </div>
  );
}

function TopList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ key: string; label: string; count: number }>;
}) {
  return (
    <div style={{
      background: "#FAFAFA",
      border: "1px solid #F1F1F1",
      borderRadius: 6,
      padding: 12,
    }}>
      <h3 style={{ fontSize: 13, fontWeight: 500, color: "#6D7175", margin: "0 0 8px 0" }}>{title}</h3>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "#9AA0A6" }}>{empty}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map((i) => (
            <li key={i.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#1A1A1A" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>
                {i.label}
              </span>
              <span style={{ fontWeight: 500 }}>{i.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  background: "#FFFFFF",
  border: "1px solid #E1E3E5",
  borderRadius: 8,
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "#1A1A1A",
  margin: 0,
};

const dateInputStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #E1E3E5",
  background: "#FAFAFA",
  fontSize: 13,
  color: "#1A1A1A",
  outline: "none",
};

const emptyTextStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "#6D7175",
};

const thStyle: React.CSSProperties = {
  fontWeight: 500,
  padding: "8px 10px",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const tdStyle: React.CSSProperties = {
  padding: "10px",
  color: "#1A1A1A",
};

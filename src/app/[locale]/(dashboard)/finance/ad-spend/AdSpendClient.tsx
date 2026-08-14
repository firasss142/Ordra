"use client";

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Plus, Upload } from "lucide-react";
import { useAdSpendCampaigns } from "@/hooks/useAdSpendCampaigns";
import { useMarketScope } from "@/context/market-scope";
import { AdSpendRollups } from "@/components/ad-spend/AdSpendRollups";
import {
  AdSpendChain,
  AdSpendCplBars,
  AdSpendCostStack,
  AdSpendProductTable,
} from "@/components/ad-spend/AdSpendEconomics";
import { useAdSpendEconomics } from "@/hooks/useAdSpendEconomics";
import { AdSpendCampaignList } from "@/components/ad-spend/AdSpendCampaignList";
import { AdSpendEntryModal } from "@/components/ad-spend/AdSpendEntryModal";
import { AdSpendCsvImport } from "@/components/ad-spend/AdSpendCsvImport";
import { EmptyState } from "@/components/dashboard/Panel";
import { computeRollups, aggregateWeeklyTimeline } from "@/lib/ad-spend/realized-metrics";
import type { AdSpendWithMetrics } from "@/lib/ad-spend/realized-metrics";
import type { AuthUser } from "@/types";
import { todayISO, startOfMonthISO } from "@/lib/date";

const AdSpendTimeline = dynamic(
  () => import("@/components/ad-spend/AdSpendTimeline").then((m) => m.AdSpendTimeline),
  { ssr: false, loading: () => <div className="h-[260px] bg-surface-sunken rounded-[8px]" /> },
);

interface Market {
  id: string;
  name: string;
  code: string;
}

interface AdSpendClientProps {
  user: AuthUser;
  markets: Market[];
  initialMarketId: string;
}

// 12-week window: from_date = 84 days ago, to_date = today
function twelveWeekFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 83);
  return d.toISOString().slice(0, 10);
}

function startOfYearISO(): string {
  return `${new Date().getUTCFullYear()}-01-01`;
}

export function AdSpendClient({ user, markets }: AdSpendClientProps) {
  const t = useTranslations("adSpend");
  const isSuperAdmin = user.role === "super_admin";

  // Global market scope is the single source of truth (sidebar switcher);
  // this page has no cross-market mode, so "all markets" shows a prompt.
  const { scope, marketId: scopeMarketId } = useMarketScope();
  const selectedMarketId = isSuperAdmin ? (scopeMarketId ?? "") : (user.market_id ?? "");
  const scopeIsAll = isSuperAdmin && scope === "all";

  const fromDate = useMemo(() => twelveWeekFrom(), []);
  const toDate = useMemo(() => todayISO(), []);
  const { products: economics, meta: economicsMeta } = useAdSpendEconomics({
    marketId: selectedMarketId,
    fromDate,
    toDate,
  });

  const currency = useMemo(
    () =>
      markets.find((m) => m.id === selectedMarketId)?.code.toUpperCase() === "LY"
        ? "LYD"
        : "TND",
    [markets, selectedMarketId],
  );

  const [editingEntry, setEditingEntry] = useState<AdSpendWithMetrics | null | undefined>(undefined); // undefined = modal closed
  const [showImport, setShowImport] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<AdSpendWithMetrics | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { entries, products, monthConfirmedCount, isLoading, mutate } = useAdSpendCampaigns({
    marketId: selectedMarketId,
    fromDate,
    toDate,
  });

  // Real YTD: a second lightweight fetch (amounts only, no metrics overlay) —
  // the 12-week window above under-covers the year for most of it.
  const ytdKey = selectedMarketId
    ? `/api/ad-spend?market_id=${selectedMarketId}&from_date=${startOfYearISO()}&to_date=${toDate}&scope=all`
    : null;
  const { data: ytdData } = useSWR<{ data: { amount: number }[] }>(ytdKey, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const ytdSum = useMemo(
    () => (ytdData?.data ?? []).reduce((s, e) => s + (Number(e.amount) || 0), 0),
    [ytdData],
  );

  const locale = user.locale ?? "fr";

  const { rollups, timelineWeeks } = useMemo(() => {
    const now = new Date();
    const base = computeRollups(entries, now, 0);
    return {
      rollups: {
        this_week: base.this_week,
        this_month: base.this_month,
        ytd: ytdSum,
        // De-duplicated market-level count from the API — overlapping
        // market-wide + product entries no longer double-count.
        avg_cost_per_conf:
          monthConfirmedCount && monthConfirmedCount > 0
            ? Math.round((base.this_month / monthConfirmedCount) * 100) / 100
            : null,
      },
      timelineWeeks: aggregateWeeklyTimeline(entries, 12, now),
    };
  }, [entries, ytdSum, monthConfirmedCount]);

  const handleSave = useCallback(
    async (
      data: {
        amount: number;
        period_start: string;
        period_end: string;
        product_id: string | null;
        note: string;
      },
      confirmLockedPeriod: boolean,
      entryId?: string,
    ) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (confirmLockedPeriod) headers["x-confirm-locked-period"] = "true";

      if (entryId) {
        const res = await fetch(`/api/ad-spend/${entryId}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message ?? `PATCH failed (${res.status})`);
        }
      } else {
        const res = await fetch("/api/ad-spend", {
          method: "POST",
          headers,
          body: JSON.stringify({ ...data, market_id: isSuperAdmin ? selectedMarketId : undefined }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.message ?? `POST failed (${res.status})`);
        }
      }
      mutate();
    },
    [selectedMarketId, isSuperAdmin, mutate],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/ad-spend/${deleteConfirm.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeleteError(body?.message ?? t("deleteError"));
        return; // keep the dialog open — the entry was NOT deleted
      }
      mutate();
      setDeleteConfirm(null);
    } catch {
      setDeleteError(t("deleteError"));
    } finally {
      setDeleting(false);
    }
  }, [deleteConfirm, mutate, t]);

  const handleImport = useCallback(
    async (
      rows: { period_start: string; period_end: string; amount: number; product_id: string | null; note?: string | null; campaign_name: string }[],
      confirmLockedPeriod = false,
    ) => {
      // The import route runs the very same closed-period guard as the entry
      // modal, so it needs the very same confirmation. Without this header a
      // super_admin's deliberate backfill into a closed quarter comes back as
      // `locked_period` for every affected row, and the import dialog can only
      // report them as invalid — an outcome indistinguishable from a malformed
      // CSV, which is how the affordance went missing unnoticed for so long.
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (confirmLockedPeriod) headers["x-confirm-locked-period"] = "true";

      const res = await fetch("/api/ad-spend/import", {
        method: "POST",
        headers,
        body: JSON.stringify({
          market_id: isSuperAdmin ? selectedMarketId : undefined,
          rows: rows.map((r) => ({
            period_start: r.period_start,
            period_end: r.period_end,
            amount: r.amount,
            product_id: r.product_id,
            // The campaign name has a column of its own now. Folding it into
            // `note` was lossy in both directions: it destroyed whatever note
            // the row carried, and it buried campaign identity in free text
            // that nothing downstream could match on.
            campaign_name: r.campaign_name,
            note: r.note ?? null,
          })),
        }),
      });
      const json = await res.json();
      mutate();
      return json?.data ?? { inserted: 0, rejected: [] };
    },
    [selectedMarketId, isSuperAdmin, mutate],
  );

  const marketLabel = markets.find((m) => m.id === selectedMarketId)?.name ?? "";

  return (
    <div className="bg-surface-page min-h-screen px-4 sm:px-6 pt-5 pb-16 flex flex-col gap-5">
      {/* Page header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="m-0 text-[20px] font-semibold text-ink-primary tracking-[-0.01em]">
              {t("title")}
            </h1>
            {marketLabel ? (
              <span className="text-[12px] font-medium text-ink-secondary px-2 py-0.5 rounded-pill bg-surface-selected">
                {marketLabel}
              </span>
            ) : null}
          </div>
          <p className="m-0 text-[13px] text-ink-secondary">{t("subtitle")}</p>
        </div>

        {!scopeIsAll ? (
          <div className="flex gap-2 flex-wrap items-center">
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium bg-surface-card border border-line rounded-[6px] text-ink-primary cursor-pointer hover:bg-surface-hover transition-colors duration-fast"
            >
              <Upload size={14} strokeWidth={1.5} />
              {t("importCsv")}
            </button>
            <button
              type="button"
              onClick={() => setEditingEntry(null)}
              className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold rounded-[6px] cursor-pointer transition-colors duration-fast"
              style={{ background: "#1A1A1A", color: "#FFFFFF", border: "none" }}
            >
              <Plus size={14} strokeWidth={2} />
              {t("addEntry")}
            </button>
          </div>
        ) : null}
      </div>

      {scopeIsAll ? (
        <div className="bg-surface-card border border-line-subtle rounded-[8px] p-6">
          <EmptyState label={t("selectMarketPrompt")} minHeight={160} />
        </div>
      ) : (
        <>
          {/* What the money turned into, end to end. Leads with the arithmetic
              rather than four totals, because a total says how much was spent
              and never whether spending it was a good idea. */}
          {economicsMeta && economicsMeta.total_leads > 0 && (
            <>
              {economicsMeta.total_spend === 0 && (
                <div className="rounded-card border border-warning/30 bg-warning-bg px-4 py-3">
                  <p className="text-[13.5px] font-semibold text-ink-primary">{t("economics.noSpendYet")}</p>
                  <p className="text-[12.5px] text-ink-secondary mt-1 leading-relaxed">
                    {t("economics.noSpendYetHint")}
                  </p>
                </div>
              )}

              <AdSpendChain meta={economicsMeta} currency={currency} />

              <div className="grid grid-cols-1 xl:grid-cols-[1.18fr_1fr] gap-4 items-start">
                <AdSpendCplBars products={economics} currency={currency} />
                <AdSpendCostStack products={economics} meta={economicsMeta} currency={currency} />
              </div>

              <AdSpendProductTable products={economics} meta={economicsMeta} currency={currency} />
            </>
          )}

          {/* KPI Rollups */}
          <AdSpendRollups
            thisWeek={rollups.this_week}
            thisMonth={rollups.this_month}
            ytd={rollups.ytd}
            avgCostPerConf={rollups.avg_cost_per_conf}
            currency={currency}
            locale={locale}
          />

          {/* Timeline chart */}
          <div className="bg-surface-card border border-line-subtle rounded-[8px] p-5 flex flex-col gap-3.5">
            <h2 className="m-0 text-[14px] font-semibold text-ink-primary">{t("timelineTitle")}</h2>
            {entries.length > 0 ? (
              <AdSpendTimeline
                weeks={timelineWeeks}
                products={products}
                marketLabel={t("card.marketWide")}
                currency={currency}
              />
            ) : (
              <EmptyState label={t("empty")} minHeight={260} />
            )}
          </div>

          {/* Section heading */}
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-[16px] font-semibold text-ink-primary">{t("campaignsTitle")}</h2>
            {isLoading && (
              <span className="text-[11px] font-medium text-ink-secondary px-2.5 py-0.5 rounded-pill bg-surface-selected uppercase tracking-[0.06em]">
                {t("refreshing")}
              </span>
            )}
          </div>

          {/* Campaign cards */}
          <AdSpendCampaignList
            entries={entries}
            products={products}
            currency={currency}
            locale={locale}
            canEditLocked={isSuperAdmin}
            isLoading={isLoading}
            onEdit={(entry) => setEditingEntry(entry)}
            onDelete={(entry) => {
              setDeleteError(null);
              setDeleteConfirm(entry);
            }}
          />
        </>
      )}

      {/* Entry modal (create or edit) */}
      {editingEntry !== undefined && (
        <AdSpendEntryModal
          entry={editingEntry}
          products={products}
          defaultPeriodStart={startOfMonthISO()}
          defaultPeriodEnd={todayISO()}
          onClose={() => setEditingEntry(undefined)}
          onSave={handleSave}
        />
      )}

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(26,26,26,0.5)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setDeleteConfirm(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="bg-surface-card rounded-[8px] p-5 w-[400px] max-w-full flex flex-col gap-4 shadow-floating"
          >
            <h2 className="m-0 text-[15px] font-semibold text-ink-primary">{t("deleteTitle")}</h2>
            <p className="m-0 text-[13px] text-ink-secondary">
              {t("deleteDescription", { amount: deleteConfirm.amount })}
            </p>
            {deleteError ? (
              <p role="alert" className="m-0 text-[12px]" style={{ color: "#D72C0D" }}>
                {deleteError}
              </p>
            ) : null}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-[13px] bg-surface-card border border-line rounded-[6px] text-ink-primary cursor-pointer hover:bg-surface-hover"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="px-4 py-2 text-[13px] font-semibold rounded-[6px]"
                style={{
                  background: "#D72C0D",
                  color: "#FFFFFF",
                  border: "none",
                  cursor: deleting ? "not-allowed" : "pointer",
                  opacity: deleting ? 0.7 : 1,
                }}
              >
                {deleting ? "…" : t("deleteConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import modal */}
      {showImport && (
        <AdSpendCsvImport
          products={products}
          marketId={selectedMarketId}
          onClose={() => setShowImport(false)}
          onImport={handleImport}
          canConfirmLocked={isSuperAdmin}
        />
      )}
    </div>
  );
}

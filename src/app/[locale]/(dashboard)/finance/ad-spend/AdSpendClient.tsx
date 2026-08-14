"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Plus, Upload } from "lucide-react";
import { useAdSpendCampaigns } from "@/hooks/useAdSpendCampaigns";
import { useMarketScope } from "@/context/market-scope";
import {
  AdSpendChain,
  AdSpendCplBars,
  AdSpendCostStack,
  AdSpendProductTable,
  AdSpendSyncStrip,
  AdSpendUnmappedBanner,
  type SyncHealth,
} from "@/components/ad-spend/AdSpendEconomics";
import { useAdSpendEconomics } from "@/hooks/useAdSpendEconomics";
import { AdSpendEntryModal } from "@/components/ad-spend/AdSpendEntryModal";
import { AdSpendCsvImport } from "@/components/ad-spend/AdSpendCsvImport";
import { EmptyState } from "@/components/dashboard/Panel";
import type { AdSpendWithMetrics } from "@/lib/ad-spend/realized-metrics";
import type { AuthUser } from "@/types";
import { todayISO, startOfMonthISO } from "@/lib/date";

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
  const locale = user.locale ?? "fr";

  const {
    products: economics,
    meta: economicsMeta,
    isLoading: economicsLoading,
    mutate: mutateEconomics,
  } = useAdSpendEconomics({ marketId: selectedMarketId, fromDate, toDate });

  const market = markets.find((m) => m.id === selectedMarketId);
  const currency = market?.code.toUpperCase() === "LY" ? "LYD" : "TND";

  const [editingEntry, setEditingEntry] = useState<AdSpendWithMetrics | null | undefined>(undefined); // undefined = modal closed
  const [showImport, setShowImport] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<AdSpendWithMetrics | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Entries and the product list back the CRUD surfaces only — every figure on
  // the page comes from the economics route. The metrics overlay is skipped
  // because nothing renders per-entry ROAS any more.
  const { entries, products, mutate } = useAdSpendCampaigns({
    marketId: selectedMarketId,
    fromDate,
    toDate,
    withMetrics: false,
  });

  const refresh = useCallback(() => {
    mutate();
    mutateEconomics();
  }, [mutate, mutateEconomics]);

  const periodLabel = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${f.format(new Date(fromDate))} – ${f.format(new Date(toDate))}`;
  }, [fromDate, toDate, locale]);

  // Nothing has synced yet: the accounts table arrives with the Meta migration.
  // Saying so out loud is the point — a blank strip would read as "healthy".
  const syncHealth: SyncHealth = useMemo(
    () => ({
      lastSyncedAt: null,
      rowsWritten: null,
      campaigns: null,
      cadenceLabel: null,
      accounts: markets.map((m) => ({
        label: m.name,
        ok: false,
        detail: t("economics.syncNotConnected"),
        note: t("economics.syncTokenPending"),
      })),
      lastError: null,
    }),
    [markets, t],
  );

  const openEntry = useCallback(
    (entryId: string) => {
      const found = entries.find((e) => e.id === entryId);
      if (found) setEditingEntry(found);
    },
    [entries],
  );

  const confirmDelete = useCallback(
    (entryId: string) => {
      const found = entries.find((e) => e.id === entryId);
      if (found) {
        setDeleteError(null);
        setDeleteConfirm(found);
      }
    },
    [entries],
  );

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
      refresh();
    },
    [selectedMarketId, isSuperAdmin, refresh],
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
      refresh();
      setDeleteConfirm(null);
    } catch {
      setDeleteError(t("deleteError"));
    } finally {
      setDeleting(false);
    }
  }, [deleteConfirm, refresh, t]);

  const handleImport = useCallback(
    async (
      rows: {
        period_start: string;
        period_end: string;
        amount: number;
        product_id: string | null;
        note?: string | null;
        campaign_name: string;
      }[],
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
      refresh();
      return json?.data ?? { inserted: 0, rejected: [] };
    },
    [selectedMarketId, isSuperAdmin, refresh],
  );

  const hasCohort = !!economicsMeta && economicsMeta.total_leads > 0;

  return (
    <div className="bg-surface-page min-h-screen px-4 sm:px-6 pt-5 pb-16 flex flex-col gap-3.5">
      {/* Page header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h1 className="m-0 text-[20px] font-semibold text-ads-ink-1 tracking-[-0.01em]">{t("title")}</h1>
          <p className="m-0 text-[12.5px] text-ads-ink-2 mt-[3px]">
            {hasCohort
              ? t("cohortSubtitle", {
                  period: periodLabel,
                  maturity: `${Math.round(economicsMeta.maturity_pct * 100)} %`,
                })
              : t("subtitle")}
          </p>
        </div>

        <span className="flex-1" />

        {!scopeIsAll && (
          <div className="flex gap-2 flex-wrap items-center">
            {market && (
              <span className="inline-flex items-center gap-1.5 border border-ads-line-2 rounded-[8px] px-[11px] py-1.5 text-[12.5px] font-semibold bg-surface-card text-ads-ink-1">
                <span className="w-[7px] h-[7px] rounded-full bg-ads-green" />
                {market.name} · {currency}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 border border-ads-orange-line rounded-[8px] px-[11px] py-1.5 text-[12.5px] font-semibold bg-ads-orange-bg text-ads-orange-ink">
              {t("economics.metaNotConnected")}
            </span>
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-1.5 border border-ads-line-2 rounded-[8px] px-3 py-[7px] text-[13px] font-semibold bg-surface-card text-ads-ink-1 hover:border-line-strong hover:bg-surface-sunken transition-colors duration-fast"
            >
              <Upload size={14} strokeWidth={1.8} />
              {t("importCsv")}
            </button>
            <button
              type="button"
              onClick={() => setEditingEntry(null)}
              className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-[7px] text-[13px] font-semibold bg-ads-green-ink text-white hover:bg-brand-hover transition-colors duration-fast"
            >
              <Plus size={14} strokeWidth={2} />
              {t("addEntry")}
            </button>
          </div>
        )}
      </div>

      {scopeIsAll ? (
        <div className="bg-surface-card border border-ads-line rounded-card p-6">
          <EmptyState label={t("selectMarketPrompt")} minHeight={160} />
        </div>
      ) : !hasCohort ? (
        <div className="bg-surface-card border border-ads-line rounded-card p-6">
          <EmptyState label={economicsLoading ? t("refreshing") : t("empty")} minHeight={260} />
        </div>
      ) : (
        <>
          <AdSpendUnmappedBanner meta={economicsMeta} currency={currency} />

          {economicsMeta.total_spend === 0 && (
            <div className="rounded-card border border-ads-orange-line bg-ads-orange-bg px-4 py-3">
              <p className="text-[13.5px] font-semibold text-ads-ink-1">{t("economics.noSpendYet")}</p>
              <p className="text-[12.5px] text-ads-ink-2 mt-1 leading-relaxed">{t("economics.noSpendYetHint")}</p>
            </div>
          )}

          {/* What the money turned into, end to end. Leads with the arithmetic
              rather than four totals, because a total says how much was spent
              and never whether spending it was a good idea. */}
          <AdSpendChain meta={economicsMeta} currency={currency} />

          <div className="grid grid-cols-1 [@media(min-width:1240px)]:grid-cols-[1.18fr_1fr] gap-3.5 items-start">
            <AdSpendCplBars
              products={economics}
              currency={currency}
              periodLabel={t("economics.overPeriod")}
            />
            <AdSpendCostStack meta={economicsMeta} currency={currency} />
          </div>

          <AdSpendProductTable
            products={economics}
            meta={economicsMeta}
            currency={currency}
            onEditEntry={openEntry}
            onDeleteEntry={confirmDelete}
          />

          <AdSpendSyncStrip health={syncHealth} />
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

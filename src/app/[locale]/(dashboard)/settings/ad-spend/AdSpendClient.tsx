"use client";

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { Plus, Upload } from "lucide-react";
import { useAdSpendCampaigns } from "@/hooks/useAdSpendCampaigns";
import { AdSpendRollups } from "@/components/ad-spend/AdSpendRollups";
import { AdSpendCampaignList } from "@/components/ad-spend/AdSpendCampaignList";
import { AdSpendEntryModal } from "@/components/ad-spend/AdSpendEntryModal";
import { AdSpendCsvImport } from "@/components/ad-spend/AdSpendCsvImport";
import { computeRollups, aggregateWeeklyTimeline } from "@/lib/ad-spend/realized-metrics";
import type { AdSpendWithMetrics } from "@/lib/ad-spend/realized-metrics";
import type { AuthUser } from "@/types";
import { todayISO, startOfMonthISO } from "@/lib/date";
import { AD_SPEND_THEME as D } from "@/components/ad-spend/theme";

const AdSpendTimeline = dynamic(
  () => import("@/components/ad-spend/AdSpendTimeline").then((m) => m.AdSpendTimeline),
  { ssr: false, loading: () => <div style={{ height: 260, background: D.cardBgAlt, borderRadius: 8 }} /> },
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

export function AdSpendClient({ user, markets, initialMarketId }: AdSpendClientProps) {
  const t = useTranslations("adSpend");
  const isSuperAdmin = user.role === "super_admin";

  const [selectedMarketId, setSelectedMarketId] = useState<string>(initialMarketId);
  const fromDate = useMemo(() => twelveWeekFrom(), []);
  const toDate = useMemo(() => todayISO(), []);
  const currency = useMemo(
    () => markets.find((m) => m.id === selectedMarketId)?.code === "LY" ? "LYD" : "TND",
    [markets, selectedMarketId],
  );

  const [editingEntry, setEditingEntry] = useState<AdSpendWithMetrics | null | undefined>(undefined); // undefined = modal closed
  const [showImport, setShowImport] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<AdSpendWithMetrics | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { entries, products, isLoading, mutate } = useAdSpendCampaigns({
    marketId: selectedMarketId,
    fromDate,
    toDate,
  });

  const locale = user.locale ?? "fr";

  const { rollupsWithConf, timelineWeeks } = useMemo(() => {
    const now = new Date();
    const monthStart = startOfMonthISO();
    const thisMonthConfs = entries
      .filter((e) => e.period_start >= monthStart)
      .reduce((s, e) => s + e.confirmed_count, 0);
    return {
      rollupsWithConf: computeRollups(entries, now, thisMonthConfs),
      timelineWeeks: aggregateWeeklyTimeline(entries, 12, now),
    };
  }, [entries]);

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
    try {
      await fetch(`/api/ad-spend/${deleteConfirm.id}`, { method: "DELETE" });
      mutate();
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  }, [deleteConfirm, mutate]);

  const handleImport = useCallback(
    async (rows: { period_start: string; period_end: string; amount: number; product_id: string | null; note?: string | null; campaign_name: string }[]) => {
      const res = await fetch("/api/ad-spend/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          market_id: isSuperAdmin ? selectedMarketId : undefined,
          rows: rows.map((r) => ({
            period_start: r.period_start,
            period_end: r.period_end,
            amount: r.amount,
            product_id: r.product_id,
            note: r.campaign_name,
          })),
        }),
      });
      const json = await res.json();
      mutate();
      return json?.data ?? { inserted: 0, rejected: [] };
    },
    [selectedMarketId, isSuperAdmin, mutate],
  );

  return (
    <div
      style={{
        padding: "32px 32px 64px",
        background: D.pageBg,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 28,
      }}
    >
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 700,
              color: D.white,
              letterSpacing: "-0.02em",
            }}
          >
            {t("title")}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: D.muted }}>
            {t("subtitle")}
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {isSuperAdmin && markets.length > 1 && (
            <select
              value={selectedMarketId}
              onChange={(e) => setSelectedMarketId(e.target.value)}
              style={{
                padding: "8px 12px",
                background: D.cardBg,
                border: `1px solid ${D.border}`,
                borderRadius: 8,
                color: D.white,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setShowImport(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 500,
              background: "transparent",
              border: `1px solid ${D.border}`,
              borderRadius: 8,
              color: D.white,
              cursor: "pointer",
            }}
          >
            <Upload size={14} strokeWidth={1.5} />
            {t("importCsv")}
          </button>

          <button
            type="button"
            onClick={() => setEditingEntry(null)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: D.white,
              border: "none",
              borderRadius: 8,
              color: "#000000",
              cursor: "pointer",
            }}
          >
            <Plus size={14} strokeWidth={2} />
            {t("addEntry")}
          </button>
        </div>
      </div>

      {/* KPI Rollups */}
      <AdSpendRollups
        thisWeek={rollupsWithConf.this_week}
        thisMonth={rollupsWithConf.this_month}
        ytd={rollupsWithConf.ytd}
        avgCostPerConf={rollupsWithConf.avg_cost_per_conf}
        currency={currency}
        locale={locale}
      />

      {/* Timeline chart */}
      <div
        style={{
          background: D.cardBg,
          border: `1px solid ${D.border}`,
          borderRadius: 12,
          padding: 20,
          boxShadow: D.shadow,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: D.white }}>
          {t("timelineTitle")}
        </h2>
        {entries.length > 0 ? (
          <AdSpendTimeline
            weeks={timelineWeeks}
            products={products}
            marketLabel={t("card.marketWide")}
            currency={currency}
          />
        ) : (
          <div
            style={{
              height: 260,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              color: D.tertiary,
            }}
          >
            {t("empty")}
          </div>
        )}
      </div>

      {/* Section heading */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: D.white }}>
          {t("campaignsTitle")}
        </h2>
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
        onDelete={(entry) => setDeleteConfirm(entry)}
      />

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
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 16,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}
        >
          <div
            style={{
              background: D.cardBg,
              border: `1px solid ${D.border}`,
              borderRadius: 12,
              padding: 24,
              width: 400,
              maxWidth: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 16,
              boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
            }}
          >
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: D.white }}>
              {t("deleteTitle")}
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: D.muted }}>
              {t("deleteDescription", { amount: deleteConfirm.amount })}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                style={{
                  padding: "9px 18px",
                  fontSize: 13,
                  background: "transparent",
                  border: `1px solid ${D.border}`,
                  borderRadius: 6,
                  color: D.muted,
                  cursor: "pointer",
                }}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                style={{
                  padding: "9px 18px",
                  fontSize: 13,
                  fontWeight: 600,
                  background: deleting ? "rgba(244,114,114,0.2)" : "rgba(244,114,114,0.15)",
                  border: "1px solid rgba(244,114,114,0.4)",
                  borderRadius: 6,
                  color: D.danger,
                  cursor: deleting ? "not-allowed" : "pointer",
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
        />
      )}
    </div>
  );
}

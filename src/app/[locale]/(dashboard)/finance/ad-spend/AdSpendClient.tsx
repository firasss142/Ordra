"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ChevronRight, Info, Link2, Loader2, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useAdSpendCampaigns } from "@/hooks/useAdSpendCampaigns";
import { useMarketScope } from "@/context/market-scope";
import {
  AdSpendChain,
  AdSpendCoverageBanner,
  AdSpendCplBars,
  AdSpendCostStack,
  AdSpendProductTable,
  AdSpendSyncStrip,
  AdSpendUnmappedBanner,
  type SyncHealth,
} from "@/components/ad-spend/AdSpendEconomics";
import { useAdSpendEconomics } from "@/hooks/useAdSpendEconomics";
import { useAdSpendSyncStatus } from "@/hooks/useAdSpendSyncStatus";
import { AdSpendEntryModal } from "@/components/ad-spend/AdSpendEntryModal";
import { AdSpendCsvImport } from "@/components/ad-spend/AdSpendCsvImport";
import { AdSpendMappingDrawer } from "@/components/ad-spend/AdSpendMappingDrawer";
import { useAdSpendMapping } from "@/hooks/useAdSpendMapping";
import { needsAttribution } from "@/lib/ad-spend/mapping-view";
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

/** « 1 239 » — the amount as the rest of the page writes it. */
function fmtAmount(n: number): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }).replace(/\u202f/g, "\u00a0");
}

// 12-week window: from_date = 84 days ago, to_date = today
function twelveWeekFrom(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 83);
  return d.toISOString().slice(0, 10);
}

/** "il y a 14 min" — the strip reads as freshness, not as a timestamp. */
function relativeTime(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const minutes = Math.round((then - Date.now()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar" : "fr", { numeric: "auto" });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}

/**
 * Next firing of an hourly `M * * * *` schedule, as a local wall time.
 *
 * Only that one shape is decoded — it is the shape this job uses — and anything
 * else falls back to showing the raw expression rather than guessing. A sync
 * strip that quietly mis-states when the next run happens is worse than one
 * that shows a cron string.
 */
function nextCronRun(schedule: string): string {
  const match = /^(\d{1,2}) \* \* \* \*$/.exec(schedule.trim());
  if (!match) return schedule;
  const minute = Number(match[1]);
  const next = new Date();
  next.setSeconds(0, 0);
  if (next.getMinutes() >= minute) next.setHours(next.getHours() + 1);
  next.setMinutes(minute);
  return next.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
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
  const marketLabel = market?.name ?? "";
  const currency = market?.code.toUpperCase() === "LY" ? "LYD" : "TND";

  const [editingEntry, setEditingEntry] = useState<AdSpendWithMetrics | null | undefined>(undefined); // undefined = modal closed
  const [showImport, setShowImport] = useState(false);
  // null = closed. The drawer opens on the most money waiting, or straight on one campaign.
  const [mapping, setMapping] = useState<{ focus: string | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<AdSpendWithMetrics | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { status: syncStatus, mutate: mutateSync } = useAdSpendSyncStatus(selectedMarketId);
  const hasMetaAccount = (syncStatus?.accounts.length ?? 0) > 0;

  // Fetched with the page, not on open: the header badge needs its count, and
  // the drawer then opens from the same SWR entry without a spinner.
  // Whole history, like the drawer: the badge and the drawer say the same number.
  const { tree: mappingTree, mutate: mutateMapping } = useAdSpendMapping({
    marketId: selectedMarketId,
    enabled: hasMetaAccount && !scopeIsAll,
  });
  const toMap = mappingTree?.campaigns.filter(needsAttribution).length ?? 0;

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
    mutateSync();
    mutateMapping();
  }, [mutate, mutateEconomics, mutateSync, mutateMapping]);

  const [syncError, setSyncError] = useState<string | null>(null);

  const runSyncNow = useCallback(async (range?: { since: string; until: string }) => {
    setSyncing(true);
    setSyncError(null);
    try {
      // market_id is a query param, not a body field — the route reads
      // `req.nextUrl.searchParams`, and a body would be silently ignored,
      // syncing every market instead of this one.
      const qs = new URLSearchParams({ market_id: selectedMarketId });
      if (range) {
        qs.set("since", range.since);
        qs.set("until", range.until);
      }
      const res = await fetch(`/api/ad-spend/sync?${qs}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        setSyncError(body?.error ?? t("economics.syncFailed"));
        return;
      }
      // A run that finished but wrote nothing is worth saying out loud — it is
      // the shape a wrong date window or a paused campaign takes.
      const failed = (body?.results ?? []).filter(
        (r: { status: string }) => r.status === "failed",
      );
      if (failed.length > 0) setSyncError(failed[0]?.error ?? t("economics.syncFailed"));
    } catch {
      setSyncError(t("economics.syncFailed"));
    } finally {
      setSyncing(false);
      refresh();
    }
  }, [selectedMarketId, refresh, t]);

  const periodLabel = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "fr-FR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    return `${f.format(new Date(fromDate))} – ${f.format(new Date(toDate))}`;
  }, [fromDate, toDate, locale]);

  // The strip has to be able to say "never synced" and "not scheduled" and be
  // right about both. Everything here comes from the sync-status route; nothing
  // is asserted. A blank strip would read as healthy, which is the one thing a
  // broken sync must never look like.
  const syncHealth: SyncHealth = useMemo(() => {
    const accounts = (syncStatus?.accounts ?? []).map((a) => {
      const tzBad = a.timezone.status === "mismatch";
      return {
        label: a.account_name ?? `act_${a.ad_account_id}`,
        ok: a.is_active && !a.last_sync_error && !tzBad,
        detail: a.last_sync_error
          ? t("economics.syncFailing")
          : !a.is_active
            ? t("economics.syncPaused")
            : tzBad
              ? t("economics.syncTimezoneOff")
              : `${t("economics.syncOk")} · ${a.account_currency}`,
        note: a.account_timezone ?? t("economics.syncTimezoneUnknown"),
      };
    });

    return {
      lastSyncedAt: relativeTime(syncStatus?.last_run?.started_at ?? null, locale),
      rowsWritten: syncStatus?.last_run?.rows_upserted ?? null,
      campaigns: syncStatus?.campaigns ?? null,
      cadenceLabel:
        syncStatus?.cadence?.active === true ? nextCronRun(syncStatus.cadence.schedule) : null,
      accounts:
        accounts.length > 0
          ? accounts
          : [
              {
                label: marketLabel || t("economics.syncNoAccount"),
                ok: false,
                detail: t("economics.syncNotConnected"),
                note: t("economics.syncTokenPending"),
              },
            ],
      lastError: syncStatus?.last_error ?? null,
    };
  }, [syncStatus, t, locale, marketLabel]);

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
  // The page's two warnings live in ONE place — the head of the drawer — and
  // the drawer's button carries their total (prototypes/finances-pub-v5.html).
  // Without a Meta account there is no drawer, so the page keeps them.
  const productsWithoutSpend = hasCohort ? economicsMeta.products_without_spend : 0;
  const warnings = toMap + productsWithoutSpend;
  const backfill =
    (syncStatus?.accounts.length ?? 0) > 0 ? () => runSyncNow({ since: fromDate, until: toDate }) : undefined;
  const maturity = hasCohort ? `${Math.round(economicsMeta.maturity_pct * 100)} %` : null;

  return (
    <>
      <div className="fin ads">
        <div className="page">
          {/* Page header — the kit's (Produits & marges) */}
          <div className="ph">
            <div>
              <div className="crumb">
                {t("economics.crumb")}
                <ChevronRight className="ic rtl:rotate-180" aria-hidden />
                {t("title")}
              </div>
              <h1>{t("title")}</h1>
              <div className="sub">
                {market && (
                  <span>
                    {market.name} · {currency}
                  </span>
                )}
                {hasCohort ? (
                  <>
                    <i className="sep" aria-hidden />
                    <span>{t("economics.cohortRange", { period: periodLabel })}</span>
                    <i className="sep" aria-hidden />
                    <span className="mat" title={t("economics.maturityTip")}>
                      {t("economics.maturity", { pct: maturity })}
                      <span className="matbar" aria-hidden>
                        <i style={{ width: maturity ?? "0" }} />
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    {market && <i className="sep" aria-hidden />}
                    <span>{t("subtitle")}</span>
                  </>
                )}
              </div>
            </div>

            {!scopeIsAll && (
              <div className="ph-r">
                <div className="acts">
                  {hasMetaAccount && (
                    <button type="button" className="btn2" onClick={() => setMapping({ focus: null })}>
                      <Link2 className="ic" aria-hidden />
                      {t("mapping.openButton")}
                      {warnings > 0 && (
                        <span className="cnt" title={t("mapping.warningsBadge", { count: warnings })}>
                          {warnings}
                        </span>
                      )}
                    </button>
                  )}
                  {hasMetaAccount && (
                    <button
                      type="button"
                      className="btn2"
                      // Wrapped: passing the handler directly would hand the
                      // click event in as the backfill range.
                      onClick={() => runSyncNow()}
                      disabled={syncing}
                    >
                      {syncing ? <Loader2 className="ic animate-spin" aria-hidden /> : <RefreshCw className="ic" aria-hidden />}
                      {t("economics.syncNow")}
                    </button>
                  )}
                  <button type="button" className="btn2" onClick={() => setShowImport(true)}>
                    <Upload className="ic" aria-hidden />
                    {t("importCsv")}
                  </button>
                  <button type="button" className="btn" onClick={() => setEditingEntry(null)}>
                    <Plus className="ic" aria-hidden />
                    {t("addEntry")}
                  </button>
                </div>
                {/* One chip, three truths: connected and fresh, connected and
                    stale, or not connected at all. */}
                {syncHealth.lastSyncedAt ? (
                  <span className="chip">
                    <i className="dot" aria-hidden />
                    {t("economics.syncedAgo", { ago: syncHealth.lastSyncedAt })}
                  </span>
                ) : (
                  <span className="chip warn">{t("economics.metaNotConnected")}</span>
                )}
              </div>
            )}
          </div>

          {scopeIsAll ? (
            <section className="card empty">{t("selectMarketPrompt")}</section>
          ) : !hasCohort ? (
            <section className="card empty">{economicsLoading ? t("refreshing") : t("empty")}</section>
          ) : (
            <>
              {syncError && (
                <div role="alert" className="note bad">
                  <span className="nh"><AlertTriangle className="ic" aria-hidden /></span>
                  <span>
                    <b>{t("economics.syncFailed")}</b> {syncError}
                  </span>
                </div>
              )}

              {/* No drawer to hold the warnings — the page keeps them. */}
              {!hasMetaAccount && (
                <>
                  <AdSpendCoverageBanner meta={economicsMeta} fromDate={fromDate} backfilling={syncing} onBackfill={backfill} />
                  <AdSpendUnmappedBanner meta={economicsMeta} currency={currency} />
                </>
              )}

              {economicsMeta.total_spend === 0 && (
                <div className="note warn">
                  <span className="nh"><AlertTriangle className="ic" aria-hidden /></span>
                  <span>
                    <b>{t("economics.noSpendYet")}</b> {t("economics.noSpendYetHint")}
                  </span>
                </div>
              )}

              {/* What the money turned into, end to end. Leads with the
                  arithmetic rather than four totals, because a total says how
                  much was spent and never whether spending it was a good idea. */}
              <AdSpendChain meta={economicsMeta} currency={currency} />

              <div className="two">
                <AdSpendCplBars products={economics} currency={currency} periodLabel={t("economics.overPeriod")} />
                <AdSpendCostStack meta={economicsMeta} currency={currency} />
              </div>

              <AdSpendProductTable
                products={economics}
                meta={economicsMeta}
                currency={currency}
                onEditEntry={openEntry}
                onDeleteEntry={confirmDelete}
                onMapCampaigns={hasMetaAccount ? () => setMapping({ focus: null }) : undefined}
                onOpenCampaign={hasMetaAccount ? (id) => setMapping({ focus: id }) : undefined}
              />

              <AdSpendSyncStrip health={syncHealth} />

              <p className="foot">
                <Info className="ic" aria-hidden />
                <span>{t("economics.basisFoot")}</span>
              </p>
            </>
          )}
        </div>
      </div>

      {/* Overlays render BESIDE `.fin`, never inside it: the kit's button
          reset would outrank the drawer's Tailwind (see ad-spend.css). */}
      <div className="ads-ov">
        {editingEntry !== undefined && (
          <AdSpendEntryModal
            entry={editingEntry}
            products={products}
            currency={currency}
            marketLabel={market ? `${market.name} · ${currency}` : currency}
            defaultPeriodStart={startOfMonthISO()}
            defaultPeriodEnd={todayISO()}
            onClose={() => setEditingEntry(undefined)}
            onSave={handleSave}
          />
        )}

        {deleteConfirm && (
          <div
            className="mscrim"
            onClick={(e) => {
              if (e.target === e.currentTarget) setDeleteConfirm(null);
            }}
          >
            <div role="dialog" aria-modal="true" aria-labelledby="ads-del-t" className="mbox s">
              <div className="dr-h">
                <div>
                  <h2 id="ads-del-t">{t("deleteTitle")}</h2>
                  <p>{t("deleteDescription", { amount: fmtAmount(deleteConfirm.amount), currency })}</p>
                </div>
              </div>
              {deleteError ? (
                <p role="alert" className="ferr" style={{ padding: "0 24px 12px" }}>
                  {deleteError}
                </p>
              ) : null}
              <div className="mf">
                <button type="button" className="btn2" onClick={() => setDeleteConfirm(null)}>
                  {t("cancel")}
                </button>
                <button type="button" className="btn bad" onClick={handleDeleteConfirm} disabled={deleting}>
                  <Trash2 className="ic" aria-hidden />
                  {deleting ? "…" : t("deleteConfirm")}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Campaign / ad set → product(s); the page's warnings sit at its head */}
        {mapping && (
          <AdSpendMappingDrawer
            marketId={selectedMarketId}
            currency={currency}
            focusCampaignId={mapping.focus}
            onClose={() => setMapping(null)}
            onSaved={refresh}
            coverage={{ count: productsWithoutSpend, fromDate, onBackfill: backfill, backfilling: syncing }}
          />
        )}

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
    </>
  );
}

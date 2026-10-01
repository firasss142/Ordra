"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Check, RefreshCw, Search, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useAdSpendMapping, type SaveMappingResult } from "@/hooks/useAdSpendMapping";
import { attributionStatus, firstToAttribute, groupCampaigns } from "@/lib/ad-spend/mapping-view";
import type { MappingTreeDTO } from "@/lib/ad-spend/mapping-types";
import { MappingList } from "./mapping/MappingList";
import { MappingDetail } from "./mapping/MappingDetail";
import { MappingEditor } from "./mapping/MappingEditor";
import { fmtDay, fmtMoney, fmtPct, localToday, relativeTime } from "./mapping/format";

/**
 * Campaigns and products: which product a Meta campaign's spend counts
 * against. Prototype: prototypes/ad-spend-mapping-v2.html; plan:
 * plans/ad-spend-mapping-redesign-v2.md; model: docs/ad-spend-mapping.md.
 *
 * No order in this system carries ad attribution (no utm, no fbclid — all
 * checked), so attribution is asserted by a person, here. A mapping holds for
 * the whole history, so the drawer works on the whole history too — never on
 * the page's period. It opens on the campaign with the most money waiting,
 * lists campaigns grouped by state, and edits one change at a time with what
 * it moves shown before anything is written.
 */

interface Props {
  marketId: string;
  currency: string;
  /** Open straight on this campaign (from a product row's breakdown). */
  focusCampaignId?: string | null;
  onClose: () => void;
  /** After a save: the page's figures moved. */
  onSaved: () => void;
}

/** null = the campaign itself; a string = one of its ad sets. */
type EditTarget = { adsetId: string | null };

const b = (chunks: ReactNode) => <b className="font-semibold">{chunks}</b>;

/** Where the drawer opens: the page's campaign, else the most money waiting, else the top of the list. */
function defaultCampaign(tree: MappingTreeDTO, focus: string | null): string | null {
  if (focus && tree.campaigns.some((c) => c.id === focus)) return focus;
  const first = firstToAttribute(tree.campaigns);
  if (first) return first.id;
  const g = groupCampaigns(tree.campaigns, { query: "", productNames: {} });
  return (g.live[0] ?? g.paused[0] ?? g.never[0])?.id ?? null;
}

export function AdSpendMappingDrawer({ marketId, currency, focusCampaignId = null, onClose, onSaved }: Props) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();
  const { tree, isLoading, error, mutate } = useAdSpendMapping({ marketId });

  const [query, setQuery] = useState("");
  const [neverOpen, setNeverOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  // Phone: one pane at a time. The list comes first unless the page named a campaign.
  const [view, setView] = useState<"list" | "detail">(focusCampaignId ? "detail" : "list");
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const products = useMemo(() => new Map((tree?.products ?? []).map((p) => [p.id, p])), [tree?.products]);
  const account = tree?.accounts[0] ?? null;
  const today = localToday(account?.timezone ?? "UTC");
  const historyFrom = tree?.window.from ?? account?.history_from ?? today;

  const selectedId = picked ?? (tree ? defaultCampaign(tree, focusCampaignId) : null);
  const campaign = tree?.campaigns.find((c) => c.id === selectedId) ?? null;
  const adset = campaign && editing?.adsetId ? (campaign.adsets.find((s) => s.id === editing.adsetId) ?? null) : null;
  const status = tree ? attributionStatus(tree) : null;
  const money = (n: number) => `${fmtMoney(n)} ${currency}`;

  const select = useCallback((id: string) => {
    setPicked(id);
    setEditing(null);
    setView("detail");
  }, []);

  const handleSaved = useCallback(
    (result: SaveMappingResult) => {
      setEditing(null);
      setToast(
        result.pending_rebuild
          ? t("savedPending")
          : result.preview.moved > 0
            ? t("savedMoved", { amount: money(result.preview.moved) })
            : t("saved"),
      );
      void mutate();
      onSaved();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, mutate, onSaved, t],
  );

  // Escape while editing leaves the editor, not the drawer: a half-made change
  // is not something to lose to a reflex.
  const close = useCallback(() => (editing ? setEditing(null) : onClose()), [editing, onClose]);

  return (
    <Sheet open onClose={close} width="w-full sm:w-[min(1080px,94vw)]" ariaLabel={t("title")}>
      {/* header */}
      <div className="flex-none flex items-start gap-3.5 px-4 pt-4 pb-3 md:px-6 md:pt-5 md:pb-3.5">
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-bold tracking-[-0.01em] text-ink-primary">{t("title")}</h2>
          <p className="hidden md:block mt-[3px] text-[13px] text-ink-secondary">{t("subtitle")}</p>
        </div>
        {account && (
          <span className="hidden md:inline-flex items-center gap-1.5 mt-[7px] text-[12px] text-ink-muted whitespace-nowrap">
            <RefreshCw size={13} aria-hidden />
            {account.last_synced_at ? t("syncedAgo", { ago: relativeTime(account.last_synced_at, locale) ?? "" }) : t("neverSynced")}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="flex-none w-[34px] h-[34px] grid place-items-center rounded-[9px] text-ink-secondary hover:bg-line-subtle hover:text-ink-primary"
        >
          <X size={18} aria-hidden />
        </button>
      </div>

      {/* one sentence, whole history */}
      {status && tree && tree.coverage.life.total > 0 && (
        <div
          className={`flex-none ${editing ? "hidden md:flex" : "flex"} flex-wrap md:flex-nowrap items-center gap-3 mx-4 mb-3 md:mx-6 md:mb-4 px-3.5 py-[11px] rounded-[12px] border text-[13px] leading-[1.4] ${
            status.waiting > 0 ? "bg-[#FFFBEB] border-ads-orange-line text-[#78350F]" : "bg-status-successBg border-[#CDE8DD] text-[#05603A]"
          }`}
        >
          <span
            aria-hidden
            className={`flex-none w-[26px] h-[26px] rounded-full grid place-items-center ${
              status.waiting > 0 ? "bg-ads-orange-bg text-ads-orange-ink" : "bg-[#D5EFE3] text-status-success"
            }`}
          >
            {status.waiting > 0 ? <AlertTriangle size={15} /> : <Check size={15} strokeWidth={2.4} />}
          </span>
          {status.waiting > 0 ? (
            <p className="flex-1 min-w-0">
              {t.rich("statusTodo", { amount: money(status.waiting), count: status.waitingCampaigns, b })}{" "}
              <button
                type="button"
                onClick={() => {
                  const first = firstToAttribute(tree.campaigns);
                  if (first) select(first.id);
                }}
                className="font-semibold underline underline-offset-[3px] whitespace-nowrap"
              >
                {t("statusGo")}
              </button>
            </p>
          ) : (
            <p className="flex-1 min-w-0">
              {t("statusDone")}
              {status.general > 0 && <span className="opacity-80"> {t("statusGeneral", { amount: money(status.general) })}</span>}
            </p>
          )}
          <span className="hidden md:flex items-center gap-2.5 text-[12px] whitespace-nowrap opacity-90">
            {t("meter", { pct: fmtPct(status.onProductsPct) })}
            <i aria-hidden className="block w-[110px] h-1.5 rounded-[3px] bg-black/[.08] overflow-hidden">
              <b className="block h-full rounded-[3px] bg-status-success" style={{ width: `${status.onProductsPct}%` }} />
            </i>
          </span>
        </div>
      )}

      {/* panes */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[372px_1fr] border-t border-line">
        <section aria-label={t("listLabel")} className={`min-h-0 flex-col md:border-e border-line ${view === "detail" ? "hidden md:flex" : "flex"}`}>
          <div className="flex-none px-3.5 pt-3 pb-1">
            <label className="relative block">
              <Search size={15} className="absolute top-[10px] start-[11px] text-ink-muted" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search")}
                aria-label={t("search")}
                className="w-full h-9 rounded-[10px] border border-line bg-surface-sunken ps-[34px] pe-2.5 text-[13px] outline-none focus:bg-surface-card focus:border-brand focus:ring-[3px] focus:ring-brand-bg"
              />
            </label>
          </div>
          {tree && <div className="flex-none flex justify-end px-[22px] pt-2 text-[11.5px] text-ink-muted">{t("column", { date: fmtDay(historyFrom, locale) })}</div>}
          <div className="flex-1 overflow-y-auto px-2 pb-7">
            {isLoading && !tree ? (
              <p className="px-4 py-6 text-[13px] text-ink-secondary">{t("loading")}</p>
            ) : error && !tree ? (
              <p role="alert" className="px-4 py-6 text-[13px] text-status-critical">{t("loadError")}</p>
            ) : !account || !tree ? (
              <p className="px-4 py-6 text-[13px] text-ink-secondary">{t("notConnected")}</p>
            ) : (
              <MappingList
                campaigns={tree.campaigns}
                query={query}
                neverOpen={neverOpen}
                onToggleNever={() => setNeverOpen((o) => !o)}
                selectedId={selectedId}
                onSelect={select}
                products={products}
                currency={currency}
              />
            )}
          </div>
        </section>

        <section className={`relative min-h-0 min-w-0 flex-col ${view === "list" ? "hidden md:flex" : "flex"}`}>
          {tree && campaign && editing ? (
            <MappingEditor
              key={`${campaign.id}|${editing.adsetId ?? ""}`}
              campaign={campaign}
              adset={adset}
              products={products}
              productList={tree.products}
              historyFrom={account?.history_from ?? null}
              marketId={marketId}
              currency={currency}
              today={today}
              onCancel={() => setEditing(null)}
              onSaved={handleSaved}
            />
          ) : tree && campaign ? (
            <MappingDetail
              key={campaign.id}
              campaign={campaign}
              products={products}
              historyFrom={historyFrom}
              span={{ from: historyFrom, to: tree.window.to }}
              currency={currency}
              onEdit={(adsetId) => setEditing({ adsetId })}
              onBack={() => setView("list")}
            />
          ) : null}
        </section>
      </div>

      {toast && (
        <div
          role="status"
          className="absolute bottom-[84px] start-1/2 -translate-x-1/2 rtl:translate-x-1/2 z-10 flex items-center gap-2 rounded-[10px] bg-ink-primary text-white px-4 py-2.5 text-[13px] whitespace-nowrap shadow-floating"
        >
          <Check size={16} className="text-[#6EE7B7]" aria-hidden />
          {toast}
        </div>
      )}
    </Sheet>
  );
}

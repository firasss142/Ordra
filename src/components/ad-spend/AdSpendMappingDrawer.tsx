"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Clock, Layers, Link2, Megaphone, Search, Split, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useAdSpendMapping, type SaveMappingResult } from "@/hooks/useAdSpendMapping";
import { filterCampaigns, isUnmapped, campaignIsActive, type ListFilter } from "@/lib/ad-spend/mapping-view";
import { MappingList, type Selection } from "./mapping/MappingList";
import { MappingDetail } from "./mapping/MappingDetail";
import { fmtDay, fmtMoney, fmtPct, localToday, relativeTime } from "./mapping/format";

/**
 * Campaign / ad set → product(s), effective-dated. Prototype:
 * prototypes/ad-spend-mapping-v1.html; plan: plans/ad-spend-adset-mapping.md.
 *
 * No order in this system carries ad attribution (no utm, no fbclid — all
 * checked), so attribution is asserted by a person, here. A campaign can sell
 * several products (the boxing-doll relaunch sold all three sizes); its ad sets
 * follow it unless one says otherwise; and every change says whether it
 * rewrites all history or starts at a date — because a remap moves money
 * between products' margins and investors' shares, some already paid out.
 *
 * Master–detail: the tree on one side, the selected node and its editor on the
 * other. The editor previews what a change will move before Apply writes it.
 */

interface Props {
  marketId: string;
  fromDate: string;
  toDate: string;
  currency: string;
  initialFilter?: ListFilter;
  /** Open straight on this campaign (from a product row's breakdown). */
  focusCampaignId?: string | null;
  onClose: () => void;
  /** After a save: the page's figures moved. */
  onSaved: () => void;
}

export function AdSpendMappingDrawer({
  marketId,
  fromDate,
  toDate,
  currency,
  initialFilter = "all",
  focusCampaignId = null,
  onClose,
  onSaved,
}: Props) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();
  const { tree, isLoading, error, mutate } = useAdSpendMapping({ marketId, fromDate, toDate });

  const [filter, setFilter] = useState<ListFilter>(focusCampaignId ? "all" : initialFilter);
  const [query, setQuery] = useState("");
  const [hideNever, setHideNever] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(focusCampaignId ? [focusCampaignId] : []));
  const [selected, setSelected] = useState<Selection | null>(
    focusCampaignId ? { campaignId: focusCampaignId, adsetId: null } : null,
  );
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const products = useMemo(() => new Map((tree?.products ?? []).map((p) => [p.id, p])), [tree?.products]);
  const productNames = useMemo(() => Object.fromEntries((tree?.products ?? []).map((p) => [p.id, p.name])), [tree?.products]);
  const account = tree?.accounts[0] ?? null;
  const today = localToday(account?.timezone ?? "UTC");

  const visible = useMemo(
    () => filterCampaigns(tree?.campaigns ?? [], { filter, query, hideNeverSpent: hideNever, productNames }),
    [tree?.campaigns, filter, query, hideNever, productNames],
  );
  const counts = useMemo(
    () => ({
      unmapped: (tree?.campaigns ?? []).filter(isUnmapped).length,
      active: (tree?.campaigns ?? []).filter(campaignIsActive).length,
      all: tree?.campaigns.length ?? 0,
    }),
    [tree?.campaigns],
  );

  const campaign = selected ? (tree?.campaigns.find((c) => c.id === selected.campaignId) ?? null) : null;
  const adset = campaign && selected?.adsetId ? (campaign.adsets.find((s) => s.id === selected.adsetId) ?? null) : null;

  const select = useCallback((s: Selection, edit = false) => {
    setSelected(s);
    setEditing(edit);
    if (s.adsetId) setExpanded((e) => new Set(e).add(s.campaignId));
  }, []);

  const toggle = useCallback((id: string) => {
    setExpanded((e) => {
      const next = new Set(e);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSaved = useCallback(
    (result: SaveMappingResult) => {
      setEditing(false);
      setToast(
        result.pending_rebuild
          ? t("savedPending")
          : result.preview.moved > 0
            ? t("savedMoved", { amount: `${fmtMoney(result.preview.moved)} ${currency}` })
            : t("saved"),
      );
      void mutate();
      onSaved();
    },
    [currency, mutate, onSaved, t],
  );

  // Escape while editing leaves the editor, not the drawer: a half-made change
  // is not something to lose to a reflex.
  const close = useCallback(() => (editing ? setEditing(false) : onClose()), [editing, onClose]);

  const life = tree?.coverage.life;
  const win = tree?.coverage.window;
  const pctOf = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);

  return (
    <Sheet open onClose={close} width="w-full sm:w-[min(1160px,94vw)]" ariaLabel={t("title")}>
      {/* header */}
      <div className="flex-none flex items-start gap-4 px-[22px] pt-[18px] pb-3.5">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold tracking-[-0.005em] text-ink-primary">{t("title")}</h2>
          <p className="text-[13px] text-ink-secondary mt-[3px]">{t("subtitle")}</p>
        </div>
        <span className="flex-1" />
        {account && (
          <div className="hidden md:flex items-center gap-2.5 ps-2 pe-2.5 py-1.5 rounded-[8px] border border-line text-[12.5px] whitespace-nowrap">
            <span className="w-6 h-6 rounded-[6px] bg-surface-sunken border border-line-subtle grid place-items-center text-ink-secondary" aria-hidden>
              <Megaphone size={13} />
            </span>
            <b className="font-semibold text-ink-primary">{account.account_name ?? `act_${account.ad_account_id}`}</b>
            {account.fx_rate && account.currency !== currency && (
              <>
                <span className="w-px h-[18px] bg-line" aria-hidden />
                <span className="text-ink-secondary tabular-nums">
                  {account.currency} → {currency} × {account.fx_rate.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}
                </span>
              </>
            )}
            <span className="w-px h-[18px] bg-line" aria-hidden />
            <span className="inline-flex items-center gap-1.5 text-ink-secondary">
              <span className={`w-[7px] h-[7px] rounded-full ${account.last_synced_at ? "bg-status-success" : "bg-status-warning"}`} aria-hidden />
              {account.last_synced_at
                ? t("syncedAgo", { ago: relativeTime(account.last_synced_at, locale) ?? "" })
                : t("neverSynced")}
            </span>
          </div>
        )}
        <button type="button" onClick={onClose} aria-label={t("close")} className="flex-none w-[34px] h-[34px] grid place-items-center rounded-[8px] text-ink-secondary hover:bg-surface-hover hover:text-ink-primary">
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      {/* coverage */}
      {tree && life && win && (
        <div className="flex-none mx-[22px] mb-3.5 grid grid-cols-1 md:grid-cols-[auto_auto_1fr] gap-x-7 gap-y-2 items-center px-4 py-3 rounded-[10px] bg-surface-sunken border border-line-subtle">
          <Stat
            label={t("coverPeriod", { from: fmtDay(tree.window.from, locale), to: fmtDay(tree.window.to, locale) })}
            value={fmtMoney(win.total)}
            unit={currency}
            badge={t("attributedPct", { pct: fmtPct(Math.floor(pctOf(win.attributed, win.total) * 10) / 10) })}
            warn={win.unmapped > 0}
          />
          <Stat
            label={tree.coverage.life_from ? t("coverSince", { date: fmtDay(tree.coverage.life_from, locale) }) : t("legendAttributed")}
            value={fmtMoney(life.total)}
            unit={currency}
            badge={t("attributedPct", { pct: fmtPct(Math.floor(pctOf(life.attributed, life.total) * 10) / 10) })}
            warn={life.unmapped > 0}
          />
          <div>
            <div className="flex h-2 rounded-[4px] overflow-hidden gap-0.5 bg-line-subtle" aria-hidden>
              <i className="block h-full bg-status-success" style={{ width: `${pctOf(life.attributed, life.total)}%` }} />
              {life.market_level > 0 && <i className="block h-full bg-ink-muted" style={{ width: `${pctOf(life.market_level, life.total)}%` }} />}
              {life.unmapped > 0 && <i className="block h-full bg-status-warning" style={{ width: `${Math.max(0.8, pctOf(life.unmapped, life.total))}%` }} />}
            </div>
            <div className="flex gap-4 flex-wrap mt-[7px] text-[11.5px] text-ink-secondary">
              <Legend swatch="bg-status-success" label={t("legendAttributed")} value={fmtMoney(life.attributed)} />
              <Legend swatch="bg-ink-muted" label={t("legendMarket")} value={fmtMoney(life.market_level)} />
              <Legend swatch="bg-status-warning" label={t("legendToMap")} value={`${fmtMoney(life.unmapped)} · ${counts.unmapped}`} />
            </div>
          </div>
        </div>
      )}

      {/* panes */}
      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[432px_1fr] border-t border-line">
        <section className={`min-h-0 flex-col border-e border-line ${selected ? "hidden md:flex" : "flex"}`}>
          <div className="flex-none px-3.5 pt-3 pb-2.5 flex flex-col gap-2.5 border-b border-line-subtle">
            <label className="relative block">
              <Search size={15} className="absolute top-[9px] start-2.5 text-ink-muted" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("search")}
                aria-label={t("search")}
                className="w-full h-[34px] rounded-[8px] border border-line ps-8 pe-2.5 text-[13px] bg-surface-card outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-bg"
              />
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              <FilterChip on={filter === "unmapped"} warn onClick={() => setFilter("unmapped")} label={t("filterUnmapped")} count={counts.unmapped} />
              <FilterChip on={filter === "active"} onClick={() => setFilter("active")} label={t("filterActive")} count={counts.active} />
              <FilterChip on={filter === "all"} onClick={() => setFilter("all")} label={t("filterAll")} count={counts.all} />
            </div>
            <label className="inline-flex items-center gap-1.5 text-[12px] text-ink-secondary cursor-pointer w-fit">
              <input type="checkbox" checked={hideNever} onChange={(e) => setHideNever(e.target.checked)} className="accent-[var(--brand)]" />
              {t("hideNever")}
            </label>
          </div>
          <div className="flex-1 overflow-y-auto pb-5">
            {isLoading && !tree ? (
              <p className="px-4 py-6 text-[13px] text-ink-secondary">{t("loading")}</p>
            ) : error ? (
              <p role="alert" className="px-4 py-6 text-[13px] text-status-critical">{t("loadError")}</p>
            ) : !account ? (
              <p className="px-4 py-6 text-[13px] text-ink-secondary">{t("notConnected")}</p>
            ) : (
              <MappingList
                campaigns={visible}
                expanded={expanded}
                selected={selected}
                onToggle={toggle}
                onSelect={select}
                products={products}
                currency={currency}
              />
            )}
          </div>
        </section>

        <section className={`min-h-0 flex-col ${selected ? "flex" : "hidden md:flex"}`}>
          <div className="flex-1 overflow-y-auto">
            {tree && campaign ? (
              <>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="md:hidden m-4 mb-0 text-[12.5px] font-semibold text-brand"
                >
                  ← {t("filterAll")}
                </button>
                <MappingDetail
                  tree={tree}
                  campaign={campaign}
                  adset={adset}
                  marketId={marketId}
                  currency={currency}
                  today={today}
                  editing={editing}
                  onEdit={() => setEditing(true)}
                  onCancelEdit={() => setEditing(false)}
                  onSaved={handleSaved}
                  onSelect={select}
                />
              </>
            ) : (
              <EmptyDetail count={counts.unmapped} />
            )}
          </div>
        </section>
      </div>

      {toast && (
        <div role="status" className="absolute bottom-5 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 z-10 flex items-center gap-2 rounded-[8px] bg-ink-primary text-white px-4 py-2.5 text-[13px] shadow-floating">
          <Check size={16} className="text-[#6EE7B7]" aria-hidden />
          {toast}
        </div>
      )}
    </Sheet>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function Stat({ label, value, unit, badge, warn }: { label: string; value: string; unit: string; badge: string; warn: boolean }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink-secondary">{label}</div>
      <div className="text-[17px] font-bold text-ink-primary mt-px whitespace-nowrap tabular-nums">
        {value}
        <small className="text-[12px] font-medium text-ink-secondary ms-[3px]">{unit}</small>
        <em className={`not-italic text-[12.5px] font-semibold ms-1.5 ${warn ? "text-ads-orange-ink" : "text-status-success"}`}>{badge}</em>
      </div>
    </div>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={`inline-block w-2 h-2 rounded-[2px] ${swatch}`} aria-hidden />
      {label} <b className="font-semibold text-ink-primary tabular-nums">{value}</b>
    </span>
  );
}

function FilterChip({ on, warn = false, onClick, label, count }: { on: boolean; warn?: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[12.5px] font-medium whitespace-nowrap ${
        on ? "bg-ink-primary border-ink-primary text-white" : "bg-surface-card border-line text-ink-secondary hover:text-ink-primary hover:border-line-strong"
      }`}
    >
      {label}
      <span className={`text-[11.5px] font-semibold ${warn && count > 0 ? (on ? "text-[#FFD98A]" : "text-ads-orange-ink") : "opacity-75"}`}>{count}</span>
    </button>
  );
}

function EmptyDetail({ count }: { count: number }) {
  const t = useTranslations("adSpend.mapping");
  const rules = [
    { icon: Layers, title: t("rule1Title"), body: t("rule1") },
    { icon: Split, title: t("rule2Title"), body: t("rule2") },
    { icon: Clock, title: t("rule3Title"), body: t("rule3") },
  ];
  return (
    <div className="h-full grid place-items-center p-10">
      <div className="max-w-[440px] text-center">
        <div className="w-12 h-12 mx-auto mb-3.5 rounded-[12px] bg-surface-sunken border border-line-subtle grid place-items-center text-ink-secondary">
          <Link2 size={22} aria-hidden />
        </div>
        <h4 className="text-[16px] font-semibold text-ink-primary">{t("emptyTitle")}</h4>
        <p className="text-[13px] text-ink-secondary mt-1.5 leading-relaxed">{t("emptyBody", { count })}</p>
        <div className="mt-[18px] flex flex-col gap-2 text-start">
          {rules.map((r) => (
            <div key={r.title} className="flex gap-2.5 items-start px-3 py-2.5 rounded-[8px] border border-line-subtle text-[12.5px] text-ink-secondary leading-snug">
              <span className="flex-none w-6 h-6 rounded-[6px] bg-surface-sunken grid place-items-center text-ink-primary">
                <r.icon size={14} aria-hidden />
              </span>
              <span>
                <b className="block font-semibold text-ink-primary">{r.title}</b>
                {r.body}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

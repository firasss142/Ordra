"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Copy, CornerDownRight, Layers, Split } from "lucide-react";
import { ProductAvatar } from "@/components/orders/ProductAvatar";
import type { SaveMappingResult } from "@/hooks/useAdSpendMapping";
import type {
  AdsetNodeDTO,
  CampaignNodeDTO,
  MappingProductDTO,
  MappingTreeDTO,
  MappingVersionDTO,
} from "@/lib/ad-spend/mapping-types";
import {
  adsetResolution,
  campaignVersion,
  draftFromVersion,
  isRunning,
  campaignIsActive,
} from "@/lib/ad-spend/mapping-view";
import { MappingChip } from "./MappingChip";
import { MappingEditor } from "./MappingEditor";
import { SpendBars } from "./SpendBars";
import { fmtDay, fmtMoney } from "./format";
import type { Selection } from "./MappingList";

export function MappingDetail({
  tree,
  campaign,
  adset,
  marketId,
  currency,
  today,
  editing,
  onEdit,
  onCancelEdit,
  onSaved,
  onSelect,
}: {
  tree: MappingTreeDTO;
  campaign: CampaignNodeDTO;
  adset: AdsetNodeDTO | null;
  marketId: string;
  currency: string;
  today: string;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaved: (result: SaveMappingResult) => void;
  onSelect: (selection: Selection, edit?: boolean) => void;
}) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();
  const products = useMemo(() => new Map(tree.products.map((p) => [p.id, p])), [tree.products]);
  const [copied, setCopied] = useState(false);

  const node = adset ?? campaign;
  const running = adset ? isRunning(adset.status) : campaignIsActive(campaign);
  const results = node.results_window;
  const resolution = adset ? adsetResolution(campaign, adset) : { version: campaignVersion(campaign), inherited: false };
  // The editor starts from the target's OWN mapping: an ad set that follows its
  // campaign starts on "follow", not on a copy of the campaign's products.
  const ownVersion = adset
    ? (adset.versions.find((v) => v.id === adset.own_current_id && v.kind !== "inherit") ?? null)
    : campaignVersion(campaign);
  const lifeFrom = tree.coverage.life_from ?? node.first_day;

  const objective =
    campaign.objective === "OUTCOME_SALES" ? t("objectiveSales") : campaign.objective === "OUTCOME_LEADS" ? t("objectiveLeads") : campaign.objective;

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(node.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refused — the id is visible anyway */
    }
  };

  return (
    <section aria-label={node.name ?? node.id} className="flex flex-col gap-[18px] px-6 pt-5 pb-7">
      {/* identity */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
          {adset ? t("kickerAdset", { campaign: campaign.name ?? campaign.id }) : [t("kickerCampaign"), objective].filter(Boolean).join(" · ")}
        </p>
        <h3 className="text-[20px] font-bold tracking-[-0.01em] text-ink-primary mt-[3px] break-words">{node.name ?? node.id}</h3>
        <div className="flex items-center gap-2 flex-wrap mt-1.5 text-[12.5px] text-ink-secondary">
          <span
            className={`inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-full border text-[12px] font-semibold ${
              running ? "bg-status-successBg text-status-success border-[#CDE8DD]" : "bg-surface-sunken text-ink-secondary border-line-subtle"
            }`}
          >
            <span className={`w-[7px] h-[7px] rounded-full ${running ? "bg-status-success" : "bg-chart-line"}`} aria-hidden />
            {running ? t("statusActive") : t("statusPaused")}
          </span>
          {node.created_time && <span>{t("createdOn", { date: fmtDay(node.created_time, locale, { year: true }) })}</span>}
          <button
            type="button"
            onClick={copyId}
            title={t("copyId")}
            className="inline-flex items-center gap-1 font-mono text-[11.5px] text-ink-secondary bg-surface-sunken border border-line-subtle rounded-[5px] px-1.5 py-px hover:text-ink-primary"
          >
            {node.id}
            <Copy size={11} aria-hidden className={copied ? "text-status-success" : ""} />
          </button>
        </div>
      </div>

      {/* figures */}
      <div className="grid grid-cols-2 sm:grid-cols-4 rounded-[10px] border border-line-subtle">
        <Kpi label={t("kpiPeriod")} value={node.spend_window > 0 ? fmtMoney(node.spend_window) : "—"} unit={node.spend_window > 0 ? currency : undefined} sub={`${fmtDay(tree.window.from, locale)} – ${fmtDay(tree.window.to, locale)}`} />
        <Kpi label={lifeFrom ? t("kpiLife", { date: fmtDay(lifeFrom, locale) }) : t("kpiPeriod")} value={node.spend_life > 0 ? fmtMoney(node.spend_life) : "—"} unit={node.spend_life > 0 ? currency : undefined} sub={node.first_day && node.last_day ? `${fmtDay(node.first_day, locale)} → ${fmtDay(node.last_day, locale)}` : ""} />
        <Kpi label={t("kpiResults")} value={results > 0 ? fmtMoney(results) : "—"} sub={t("kpiResultsSub")} />
        <Kpi label={t("kpiCost")} value={results > 0 ? fmtMoney(node.spend_window / results, 2) : "—"} unit={results > 0 ? currency : undefined} />
      </div>

      <SpendBars daily={node.daily} from={tree.window.from} to={tree.window.to} currency={currency} />

      {/* attribution */}
      <Block
        title={t("attribution")}
        action={
          !editing && (
            <button type="button" onClick={onEdit} className="h-7 px-2.5 rounded-[7px] border border-line-strong bg-surface-card text-[12.5px] font-semibold hover:bg-surface-hover">
              {t("edit")}
            </button>
          )
        }
      >
        {editing ? (
          <MappingEditor
            key={`${campaign.id}|${adset?.id ?? ""}`}
            tree={tree}
            campaign={campaign}
            adset={adset}
            marketId={marketId}
            currency={currency}
            today={today}
            initial={draftFromVersion(ownVersion, { today, isAdset: !!adset })}
            onCancel={onCancelEdit}
            onSaved={onSaved}
          />
        ) : (
          <Current version={resolution.version} inherited={resolution.inherited} campaignName={campaign.name ?? campaign.id} products={products} />
        )}
      </Block>

      {!editing && !adset && campaign.adsets.length > 0 && (
        <Block title={t("adsets")} hint={String(campaign.adsets.length)}>
          <div className="rounded-[10px] border border-line-subtle">
            {campaign.adsets.map((s) => {
              const res = adsetResolution(campaign, s);
              return (
                <div key={s.id} className="grid grid-cols-[1fr_auto_auto] gap-3.5 items-center px-3.5 py-2.5 border-t border-line-subtle first:border-t-0">
                  <div className="min-w-0">
                    <b className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-primary">
                      <span className={`flex-none w-[7px] h-[7px] rounded-full ${isRunning(s.status) ? "bg-status-success" : "bg-chart-line"}`} aria-hidden />
                      <span className="truncate">{s.name ?? s.id}</span>
                    </b>
                    <div className="mt-1">
                      <MappingChip version={res.version} inherited={res.inherited} products={products} />
                    </div>
                  </div>
                  <div className="text-end text-[13px] font-semibold tabular-nums whitespace-nowrap">
                    {s.spend_window > 0 ? `${fmtMoney(s.spend_window)} ${currency}` : "—"}
                    {s.spend_life > 0 && lifeFrom && (
                      <small className="block text-[11px] font-normal text-ink-secondary">
                        {t("lifeOnly", { amount: `${fmtMoney(s.spend_life)} ${currency}`, date: fmtDay(lifeFrom, locale) })}
                      </small>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelect({ campaignId: campaign.id, adsetId: s.id }, true)}
                    className="h-7 px-2.5 rounded-[7px] border border-line-strong bg-surface-card text-[12px] font-semibold hover:bg-surface-hover whitespace-nowrap"
                  >
                    {t("setOverride")}
                  </button>
                </div>
              );
            })}
          </div>
        </Block>
      )}

      {!editing && (
        <HistoryTimeline
          versions={adset ? adset.versions : campaign.versions}
          currentId={adset ? adset.own_current_id : campaign.current_id}
          products={products}
        />
      )}
    </section>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function Block({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <h4 className="text-[14px] font-semibold text-ink-primary">{title}</h4>
        {hint && <span className="text-[12px] text-ink-secondary">{hint}</span>}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </div>
  );
}

function Kpi({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="px-3.5 py-[11px] border-s border-line-subtle first:border-s-0 [&:nth-child(3)]:max-sm:border-s-0 max-sm:[&:nth-child(n+3)]:border-t">
      <div className="text-[11.5px] text-ink-secondary">{label}</div>
      <div className="text-[19px] font-bold text-ink-primary mt-0.5 tabular-nums whitespace-nowrap">
        {value}
        {unit && <small className="text-[12px] font-medium text-ink-secondary ms-[3px]">{unit}</small>}
      </div>
      {sub && <div className="text-[11.5px] text-ink-muted mt-px">{sub}</div>}
    </div>
  );
}

function Current({
  version,
  inherited,
  campaignName,
  products,
}: {
  version: MappingVersionDTO | null;
  inherited: boolean;
  campaignName: string;
  products: Map<string, MappingProductDTO>;
}) {
  const t = useTranslations("adSpend.mapping");

  const lines = version && version.kind === "products" ? version.lines : [];
  return (
    <div className={`rounded-[10px] border overflow-hidden ${!version ? "border-ads-orange-line bg-ads-orange-bg" : "border-line"}`}>
      {inherited && (
        <div className="flex items-center gap-1.5 px-3.5 py-2.5 border-b border-line-subtle text-[13px] text-ink-secondary">
          <CornerDownRight size={14} className="rtl:-scale-x-100" aria-hidden />
          {t("followsCampaign", { campaign: campaignName })}
        </div>
      )}
      {!version && <p className="px-3.5 py-3 text-[13px] font-medium text-ads-orange-ink">{t("curUnmapped")}</p>}
      {version?.kind === "market_level" && <p className="px-3.5 py-3 text-[13px] text-ink-primary">{t("curMarket")}</p>}
      {lines.map((l) => {
        const p = products.get(l.product_id);
        const name = p?.name ?? l.product_id;
        const share = lines.length === 1 ? "100 %" : version?.split_mode === "manual" && l.share_pct !== null ? `${l.share_pct.toLocaleString("fr-FR")} %` : t("modeAuto");
        return (
          <div key={l.product_id} className="flex items-center gap-3 px-3.5 py-[11px] border-t border-line-subtle first:border-t-0">
            <ProductAvatar imageUrl={p?.image_url ?? null} productName={name} size={32} />
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-semibold text-ink-primary truncate"><bdi>{name}</bdi></div>
              <div className="text-[11.5px] text-ink-secondary">
                {[p?.sku, p && !p.is_active ? t("inactiveProduct") : null].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div className="text-[14px] font-bold tabular-nums">{share}</div>
          </div>
        );
      })}
      {lines.length > 1 && (
        <div className="flex items-center gap-2 px-3.5 py-2 bg-surface-sunken border-t border-line-subtle text-[12px] text-ink-secondary">
          <Split size={13} aria-hidden />
          {version?.split_mode === "manual" ? t("splitManual") : t("splitAuto")}
        </div>
      )}
    </div>
  );
}

function HistoryTimeline({
  versions,
  currentId,
  products,
}: {
  versions: MappingVersionDTO[];
  currentId: string | null;
  products: Map<string, MappingProductDTO>;
}) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();
  if (versions.length === 0) return null;

  return (
    <Block title={t("history")}>
      <ol className="flex flex-col">
        {versions.map((v, i) => {
          const replaced = v.superseded_at !== null;
          const now = v.id === currentId && !replaced;
          return (
            <li key={v.id} className="relative grid grid-cols-[18px_1fr] gap-2.5 pb-3">
              {i < versions.length - 1 && <span aria-hidden className="absolute start-2 top-[18px] bottom-0 w-px bg-line" />}
              <span aria-hidden className={`mt-[5px] ms-1 w-2.5 h-2.5 rounded-full border-2 ${now ? "bg-brand border-brand" : "bg-surface-card border-chart-line"}`} />
              <div className={replaced ? "opacity-60" : ""}>
                <div className="text-[12.5px] text-ink-secondary">
                  <b className={`font-semibold text-ink-primary ${replaced ? "line-through decoration-ink-muted" : ""}`}>
                    {v.effective_from ? t("fromDate", { date: fmtDay(v.effective_from, locale, { year: true }) }) : t("sinceStart")}
                  </b>
                  {" · "}
                  {t("byWho", { who: v.created_by_name ?? "—", date: fmtDay(v.created_at, locale, { year: true }) })}
                  {replaced && v.superseded_at ? ` · ${t("replacedOn", { date: fmtDay(v.superseded_at, locale) })}` : null}
                  {now && (
                    <span className="ms-1.5 text-[10.5px] font-bold uppercase tracking-[0.04em] px-1.5 py-px rounded-[4px] bg-brand-bg text-brand">
                      {t("inForce")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  {v.kind === "inherit" ? (
                    <span className="inline-flex items-center gap-1 text-[12px] text-ink-secondary">
                      <Layers size={12} aria-hidden />
                      {t("kindInherit")}
                    </span>
                  ) : (
                    <MappingChip version={v} products={products} />
                  )}
                  {v.kind === "products" && v.split_mode === "manual" &&
                    v.lines.map((l) => (
                      <span key={l.product_id} className="inline-flex items-center h-5 px-[7px] rounded-full border border-line text-[11.5px] font-semibold text-ink-secondary">
                        <bdi className="max-w-[140px] truncate">{products.get(l.product_id)?.name ?? l.product_id}</bdi>&nbsp;{l.share_pct} %
                      </span>
                    ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </Block>
  );
}


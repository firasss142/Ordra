"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { CampaignNodeDTO, MappingProductDTO } from "@/lib/ad-spend/mapping-types";
import { adsetResolution, campaignVersion, isRunning, campaignIsActive } from "@/lib/ad-spend/mapping-view";
import { MappingChip } from "./MappingChip";
import { fmtDay, fmtMoney } from "./format";

export interface Selection {
  campaignId: string;
  adsetId: string | null;
}

function StatusDot({ on }: { on: boolean }) {
  return <span aria-hidden className={`flex-none w-[7px] h-[7px] rounded-full ${on ? "bg-status-success" : "bg-chart-line"}`} />;
}

/**
 * The campaign → ad set tree. Spent campaigns first (by spend over the page's
 * window), never-spent ones in their own group — they are listed so a new
 * campaign can be mapped before its first dinar, not to compete for attention.
 */
export function MappingList({
  campaigns,
  expanded,
  selected,
  onToggle,
  onSelect,
  products,
  currency,
}: {
  campaigns: CampaignNodeDTO[];
  expanded: Set<string>;
  selected: Selection | null;
  onToggle: (campaignId: string) => void;
  onSelect: (selection: Selection) => void;
  products: Map<string, MappingProductDTO>;
  currency: string;
}) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();

  const spent = campaigns.filter((c) => c.spend_life > 0);
  const never = campaigns.filter((c) => c.spend_life <= 0);

  const row = (c: CampaignNodeDTO) => {
    const open = expanded.has(c.id);
    const isSel = selected?.campaignId === c.id && selected.adsetId === null;
    const version = campaignVersion(c);
    const inactive = version?.lines.some((l) => products.get(l.product_id)?.is_active === false) ?? false;
    return (
      <li key={c.id}>
        <div
          className={`relative flex border-s-[3px] ${
            isSel ? "bg-brand-bg border-brand" : "border-transparent hover:bg-surface-hover"
          }`}
        >
          <button
            type="button"
            onClick={() => onToggle(c.id)}
            aria-expanded={open}
            aria-label={t("expand", { name: c.name ?? c.id })}
            disabled={c.adsets.length === 0}
            className="flex-none mt-[11px] ms-2 w-5 h-5 grid place-items-center rounded-[5px] text-ink-muted hover:bg-black/5 hover:text-ink-primary disabled:opacity-0"
          >
            <ChevronRight
              size={14}
              strokeWidth={2.2}
              className={`transition-transform duration-fast ${open ? "rotate-90" : "rtl:rotate-180"}`}
            />
          </button>
          <button
            type="button"
            onClick={() => onSelect({ campaignId: c.id, adsetId: null })}
            aria-current={isSel ? "true" : undefined}
            className="flex-1 min-w-0 text-start ps-1.5 pe-3.5 py-2.5 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5"
          >
            <span className="flex items-center gap-[7px] min-w-0">
              <StatusDot on={campaignIsActive(c)} />
              <b className="text-[13.5px] font-semibold text-ink-primary truncate">{c.name ?? c.id}</b>
            </span>
            {c.spend_window > 0 ? (
              <span className="text-[13px] font-semibold tabular-nums text-end whitespace-nowrap text-ink-primary">
                {fmtMoney(c.spend_window)}
                <small className="text-[11px] font-medium text-ink-secondary ms-0.5">{currency}</small>
              </span>
            ) : (
              <span className="text-[13px] text-ink-muted text-end">—</span>
            )}
            <span className="col-span-2 flex items-center gap-1.5 flex-wrap text-[12px] text-ink-secondary">
              {t("adsetCount", { count: c.adsets.length })}
              <span className="text-ink-muted">·</span>
              {campaignIsActive(c) ? t("statusActive") : t("statusPaused")}
              {c.spend_window <= 0 && c.spend_life > 0 && c.first_day && (
                <>
                  <span className="text-ink-muted">·</span>
                  {t("lifeOnly", { amount: `${fmtMoney(c.spend_life)} ${currency}`, date: fmtDay(c.first_day, locale) })}
                </>
              )}
            </span>
            <span className="col-span-2 mt-1 flex items-center gap-1.5 min-w-0">
              <MappingChip version={version} products={products} />
              {inactive && <span className="text-[11.5px] text-ink-muted">{t("inactiveProduct")}</span>}
            </span>
          </button>
        </div>

        {open && c.adsets.length > 0 && (
          <ul>
            {c.adsets.map((s, i) => {
              const res = adsetResolution(c, s);
              const sel = selected?.campaignId === c.id && selected.adsetId === s.id;
              const last = i === c.adsets.length - 1;
              return (
                <li key={s.id} className="relative">
                  {/* the tree's elbow */}
                  <span aria-hidden className={`absolute start-[22px] top-0 w-px bg-line ${last ? "h-[18px]" : "bottom-0"}`} />
                  <span aria-hidden className="absolute start-[22px] top-[18px] w-3 h-px bg-line" />
                  <button
                    type="button"
                    onClick={() => onSelect({ campaignId: c.id, adsetId: s.id })}
                    aria-current={sel ? "true" : undefined}
                    className={`w-full text-start grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 ps-11 pe-3.5 py-2 border-s-[3px] ${
                      sel ? "bg-brand-bg border-brand" : "border-transparent hover:bg-surface-hover"
                    }`}
                  >
                    <span className="flex items-center gap-[7px] min-w-0 text-[12.5px] font-medium text-ink-primary">
                      <StatusDot on={isRunning(s.status)} />
                      <span className="truncate">{s.name ?? s.id}</span>
                      {!res.inherited && (
                        <span className="flex-none text-[10px] font-bold uppercase tracking-[0.05em] border border-ink-primary rounded-[4px] px-1 leading-[15px]">
                          {t("own")}
                        </span>
                      )}
                    </span>
                    <span className={`text-[12px] tabular-nums text-end whitespace-nowrap ${s.spend_window > 0 ? "font-semibold text-ink-primary" : "text-ink-muted"}`}>
                      {s.spend_window > 0 ? fmtMoney(s.spend_window) : "—"}
                    </span>
                    <span className="col-span-2 mt-0.5 flex items-center min-w-0">
                      <MappingChip version={res.version} inherited={res.inherited} products={products} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  if (campaigns.length === 0) {
    return <p className="px-4 py-7 text-center text-[13px] text-ink-secondary">{t("noResults")}</p>;
  }

  return (
    <div className="py-1.5">
      {spent.length > 0 && never.length > 0 && <GroupLabel>{t("groupSpent")}</GroupLabel>}
      <ul aria-label={t("listLabel")}>
        {spent.map(row)}
        {never.length > 0 && (
          <li aria-hidden className="list-none">
            <GroupLabel>{t("groupNever")}</GroupLabel>
          </li>
        )}
        {never.map(row)}
      </ul>
    </div>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-[18px] pt-3 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink-muted">
      {children}
    </div>
  );
}

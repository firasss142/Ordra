"use client";

import { useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { CampaignNodeDTO, MappingProductDTO } from "@/lib/ad-spend/mapping-types";
import { campaignVersion, groupCampaigns, needsAttribution, ownAdsets, type CampaignGroup } from "@/lib/ad-spend/mapping-view";
import { CampaignThumb } from "./VersionLabel";
import { fmtMoney } from "./format";

/**
 * Campaigns only, grouped by state: À attribuer · En cours · En pause, then
 * the ones that never ran, folded. The group names the state, so a row only
 * says what it sells and what it spent — the rule the agent queue already
 * uses. Ad sets live in the detail, where they matter.
 */
export function MappingList({
  campaigns,
  query,
  neverOpen,
  onToggleNever,
  selectedId,
  onSelect,
  products,
  currency,
}: {
  campaigns: CampaignNodeDTO[];
  query: string;
  neverOpen: boolean;
  onToggleNever: () => void;
  selectedId: string | null;
  onSelect: (campaignId: string) => void;
  products: Map<string, MappingProductDTO>;
  currency: string;
}) {
  const t = useTranslations("adSpend.mapping");
  const productNames = useMemo(() => Object.fromEntries([...products.values()].map((p) => [p.id, p.name])), [products]);
  const groups = useMemo(() => groupCampaigns(campaigns, { query, productNames }), [campaigns, query, productNames]);

  const total = groups.todo.length + groups.live.length + groups.paused.length + groups.never.length;
  if (total === 0) return <p className="px-[18px] py-7 text-center text-[13px] text-ink-secondary">{t("noResults")}</p>;

  const row = (c: CampaignNodeDTO) => {
    const sel = c.id === selectedId;
    const version = campaignVersion(c);
    const waiting = needsAttribution(c);
    const own = ownAdsets(c).length;

    // The product name is isolated on its own: an Arabic name must not drag
    // the French suffix to its side.
    let sells: ReactNode;
    const suffix: string[] = [];
    let tone = "text-ink-secondary";
    if (!version) {
      sells = t("noProduct");
      tone = waiting ? "text-ads-orange-ink font-semibold" : "text-ink-muted";
    } else if (version.kind === "market_level" || version.lines.length === 0) {
      sells = t("general");
    } else if (version.lines.length === 1) {
      const p = products.get(version.lines[0].product_id);
      sells = <bdi>{p?.name ?? version.lines[0].product_id}</bdi>;
      if (p && !p.is_active) suffix.push(t("inactiveProduct"));
    } else {
      sells = t("multi", { count: version.lines.length, mode: version.split_mode === "manual" ? t("modeManual") : t("modeAuto") });
    }
    if (own > 0) suffix.push(t("ownAdsets", { count: own }));

    return (
      <button
        key={c.id}
        type="button"
        onClick={() => onSelect(c.id)}
        aria-current={sel ? "true" : undefined}
        className={`w-full grid grid-cols-[36px_minmax(0,1fr)_auto] gap-3 items-center px-2.5 py-[9px] rounded-[10px] text-start ${
          sel ? "bg-brand-bg ring-1 ring-inset ring-[#B7DEC4]" : "hover:bg-surface-page"
        }`}
      >
        <CampaignThumb version={version} waiting={waiting} products={products} />
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] font-semibold text-ink-primary">{c.name ?? c.id}</span>
          <span className={`block truncate text-[12.5px] mt-px ${tone}`}>
            {sells}
            {suffix.map((x) => ` · ${x}`).join("")}
          </span>
        </span>
        {c.spend_life > 0 ? (
          <span className="text-[13px] font-semibold whitespace-nowrap tabular-nums text-ink-primary">
            {fmtMoney(c.spend_life)}
            <small className="text-[11px] font-medium text-ink-secondary ms-[3px]">{currency}</small>
          </span>
        ) : (
          <span className="text-[13px] font-medium text-ink-muted">—</span>
        )}
      </button>
    );
  };

  const group = (key: Exclude<CampaignGroup, "never">, label: string) =>
    groups[key].length > 0 && (
      <div key={key}>
        <h3 className={`flex items-center gap-2 px-2.5 pt-3.5 pb-1.5 text-[12.5px] font-semibold ${key === "todo" ? "text-ads-orange-ink" : "text-ink-secondary"}`}>
          <span>{label}</span>
          <Count warn={key === "todo"}>{groups[key].length}</Count>
        </h3>
        {groups[key].map(row)}
      </div>
    );

  // Searching opens the fold: a match must never hide behind a chevron.
  const showNever = neverOpen || query.trim() !== "";

  return (
    <>
      {group("todo", t("groupTodo"))}
      {group("live", t("groupLive"))}
      {group("paused", t("groupPaused"))}
      {groups.never.length > 0 && (
        <>
          <button
            type="button"
            onClick={onToggleNever}
            aria-expanded={showNever}
            className="flex items-center gap-2 w-full mt-2.5 p-2.5 rounded-[10px] text-start text-[12.5px] font-semibold text-ink-secondary hover:bg-surface-page hover:text-ink-primary"
          >
            <ChevronRight size={14} strokeWidth={2.2} aria-hidden className={`transition-transform duration-fast ${showNever ? "rotate-90" : "rtl:-scale-x-100"}`} />
            {t("groupNever", { count: groups.never.length })}
          </button>
          {showNever && groups.never.map(row)}
        </>
      )}
    </>
  );
}

export function Count({ warn = false, children }: { warn?: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-grid place-items-center min-w-5 h-5 px-1.5 rounded-[10px] text-[11.5px] font-bold tabular-nums ${
        warn ? "bg-ads-orange-bg text-ads-orange-ink" : "bg-line-subtle text-ink-secondary"
      }`}
    >
      {children}
    </span>
  );
}

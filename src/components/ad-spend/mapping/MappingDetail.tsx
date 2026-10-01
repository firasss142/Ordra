"use client";

import { useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, CircleHelp, Clock, CornerDownRight, Globe, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { CampaignNodeDTO, MappingProductDTO, MappingVersionDTO } from "@/lib/ad-spend/mapping-types";
import {
  adsetOwnVersion,
  campaignIsActive,
  campaignVersion,
  isRunning,
  needsAttribution,
  ownAdsets,
} from "@/lib/ad-spend/mapping-view";
import { Count } from "./MappingList";
import { SpendBars } from "./SpendBars";
import { ProductThumb, VersionLabel } from "./VersionLabel";
import { fmtDay, fmtMoney, fmtPct } from "./format";

const b = (chunks: ReactNode) => <b className="font-semibold text-ink-primary">{chunks}</b>;

/**
 * One campaign: its name, one sentence of spend, a slim strip — then straight
 * to the question, what it sells. No KPIs, no Meta id, no objective: Meta
 * purchases and cost per purchase stay on the page's product table. Ad sets
 * appear only when there are several, because one ad set has nothing to add.
 */
export function MappingDetail({
  campaign: c,
  products,
  historyFrom,
  span,
  currency,
  onEdit,
  onBack,
}: {
  campaign: CampaignNodeDTO;
  products: Map<string, MappingProductDTO>;
  /** Where the history starts — "since 23 May". */
  historyFrom: string;
  /** The whole history, the strip's axis. */
  span: { from: string; to: string };
  currency: string;
  /** Open the editor on the campaign (null) or one of its ad sets. */
  onEdit: (adsetId: string | null) => void;
  /** Phone only: back to the list. */
  onBack: () => void;
}) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();
  const [historyOpen, setHistoryOpen] = useState(false);

  const version = campaignVersion(c);
  const live = campaignIsActive(c);
  const waiting = needsAttribution(c);
  const own = ownAdsets(c);
  const money = (n: number) => `${fmtMoney(n)} ${currency}`;

  const pill = live ? (
    <Pill className="bg-status-successBg text-status-success" dot>{t("pillLive")}</Pill>
  ) : c.spend_life > 0 ? (
    <Pill className="bg-line-subtle text-ink-secondary" dot>{t("pillPaused")}</Pill>
  ) : (
    <Pill className="bg-line-subtle text-ink-secondary">{t("pillNever")}</Pill>
  );

  const spent =
    c.spend_life > 0 && c.first_day && c.last_day
      ? c.first_day === c.last_day
        ? t.rich("spentOne", { amount: money(c.spend_life), date: fmtDay(c.first_day, locale), b })
        : t.rich("spentRange", { amount: money(c.spend_life), from: fmtDay(c.first_day, locale), to: fmtDay(c.last_day, locale), b })
      : t("spentNone", { date: fmtDay(historyFrom, locale) });

  return (
    <div className="flex-1 overflow-y-auto px-4 pt-4 pb-7 md:px-7 md:pt-6 md:pb-9">
      <section aria-label={c.name ?? c.id} className="max-w-[660px] flex flex-col gap-7">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="md:hidden mb-2.5 -ms-1 flex w-fit items-center gap-1 h-7 ps-1 pe-2 rounded-[7px] text-[13px] font-semibold text-ink-secondary hover:bg-line-subtle hover:text-ink-primary"
          >
            <ChevronLeft size={16} strokeWidth={2.2} className="rtl:-scale-x-100" aria-hidden />
            {t("backToList")}
          </button>
          {pill}
          <h3 className="mt-2.5 text-[22px] font-bold tracking-[-0.015em] text-ink-primary break-words">{c.name ?? c.id}</h3>
          <p className="mt-1 text-[13.5px] text-ink-secondary">{spent}</p>
          {c.spend_life > 0 && (
            <SpendBars daily={c.daily} from={span.from} to={span.to} currency={currency} label={t("sparkLabel", { date: fmtDay(historyFrom, locale) })} />
          )}
        </div>

        <section className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2 min-h-7">
            <h4 className="text-[15px] font-semibold text-ink-primary">{t("sells")}</h4>
            <span className="flex-1" />
            {version && (
              <Button variant="secondary" className="!h-7 !px-2.5 !text-[12.5px]" onClick={() => onEdit(null)}>
                {t("edit")}
              </Button>
            )}
          </div>

          {!version ? (
            <div className={`rounded-[12px] border overflow-hidden ${waiting ? "border-ads-orange-line bg-[#FFFBEB]" : "border-line bg-surface-card"}`}>
              <Ask
                icon={<CircleHelp size={20} />}
                warn={waiting}
                title={t("unTitle")}
                body={c.spend_unattributed > 0 ? t("unBody", { amount: money(c.spend_unattributed) }) : t("unNever")}
              >
                <Button variant={waiting ? "primary" : "secondary"} className="mt-3" onClick={() => onEdit(null)}>
                  <Plus size={15} strokeWidth={2.2} aria-hidden />
                  {t("choose")}
                </Button>
              </Ask>
            </div>
          ) : (
            <SellsCard
              version={version}
              versions={c.versions}
              spendByProduct={c.spend_by_product}
              products={products}
              currency={currency}
              historyOpen={historyOpen}
              onToggleHistory={() => setHistoryOpen((o) => !o)}
            />
          )}

          {version && own.length > 0 && (
            <p className="flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
              <CornerDownRight size={13} className="rtl:-scale-x-100" aria-hidden />
              {t("except", { count: own.length })}
            </p>
          )}
        </section>

        {(c.adsets.length > 1 || own.length > 0) && (
          <section className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2 min-h-7">
              <h4 className="text-[15px] font-semibold text-ink-primary">{t("adsets")}</h4>
              <Count>{c.adsets.length}</Count>
            </div>
            <p className="-mt-0.5 text-[12.5px] leading-normal text-ink-secondary">{t("adsetsHint")}</p>
            <div className="rounded-[12px] border border-line bg-surface-card overflow-hidden">
              {c.adsets.map((s) => {
                const sv = adsetOwnVersion(s);
                return (
                  <div
                    key={s.id}
                    data-adset={s.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-3.5 items-center px-3.5 py-2.5 border-t border-line-subtle first:border-t-0"
                  >
                    <div className="min-w-0">
                      <b className="block truncate text-[13px] font-semibold text-ink-primary">
                        {s.name ?? s.id}
                        {isRunning(s.status) && <span className="ms-1.5 text-[11.5px] font-semibold text-status-success">● {t("pillLive")}</span>}
                      </b>
                      <span className="mt-0.5 flex items-center gap-1.5 min-w-0 text-[12px] text-ink-secondary">
                        <VersionLabel version={sv} products={products} />
                      </span>
                    </div>
                    <span className={`hidden sm:block text-[13px] whitespace-nowrap tabular-nums ${s.spend_life > 0 ? "font-semibold text-ink-primary" : "font-medium text-ink-muted"}`}>
                      {s.spend_life > 0 ? money(s.spend_life) : "—"}
                    </span>
                    <Button
                      variant={sv ? "secondary" : "ghost"}
                      className={`!h-7 !px-2.5 !text-[12.5px] ${sv ? "" : "!text-ink-secondary"}`}
                      onClick={() => onEdit(s.id)}
                    >
                      {sv ? t("edit") : t("setOwn")}
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────────── pieces ─────────────────────────── */

function Pill({ className, dot = false, children }: { className: string; dot?: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 h-[22px] px-[9px] rounded-[11px] text-[12px] font-semibold ${className}`}>
      {dot && <i aria-hidden className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Ask({ icon, warn = false, title, body, children }: { icon: ReactNode; warn?: boolean; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex gap-3.5 items-start p-4">
      <span aria-hidden className={`flex-none w-10 h-10 grid place-items-center rounded-[10px] ${warn ? "bg-ads-orange-bg text-ads-orange-ink" : "bg-line-subtle text-ink-secondary"}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <b className={`block text-[14px] font-semibold ${warn ? "text-[#78350F]" : "text-ink-primary"}`}>{title}</b>
        <p className={`mt-0.5 text-[13px] leading-normal ${warn ? "text-[#92400E]" : "text-ink-secondary"}`}>{body}</p>
        {children}
      </div>
    </div>
  );
}

export function GeneralAsk() {
  const t = useTranslations("adSpend.mapping");
  return <Ask icon={<Globe size={20} />} title={t("genTitle")} body={t("genBody")} />;
}

function SellsCard({
  version,
  versions,
  spendByProduct,
  products,
  currency,
  historyOpen,
  onToggleHistory,
}: {
  version: MappingVersionDTO;
  versions: MappingVersionDTO[];
  spendByProduct: Record<string, number>;
  products: Map<string, MappingProductDTO>;
  currency: string;
  historyOpen: boolean;
  onToggleHistory: () => void;
}) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();
  const general = version.kind === "market_level" || version.lines.length === 0;
  const several = !general && version.lines.length > 1;
  // What each product actually carried; a fixed split with nothing spent yet shows its percentages.
  const carried = version.lines.reduce((s, l) => s + (spendByProduct[l.product_id] ?? 0), 0);
  const share = (id: string, pct: number | null) =>
    carried > 0 ? ((spendByProduct[id] ?? 0) / carried) * 100 : version.split_mode === "manual" ? pct : null;

  return (
    <div className="rounded-[12px] border border-line bg-surface-card overflow-hidden">
      {general ? (
        <GeneralAsk />
      ) : (
        version.lines.map((l) => {
          const p = products.get(l.product_id);
          const pct = several ? share(l.product_id, l.share_pct) : 100;
          return (
            <div key={l.product_id} className="flex items-center gap-3 px-3.5 py-3 border-t border-line-subtle first:border-t-0">
              <ProductThumb id={l.product_id} products={products} size={44} />
              <div className="flex-1 min-w-0">
                <b className="block truncate text-[14px] font-semibold text-ink-primary">
                  <bdi>{p?.name ?? l.product_id}</bdi>
                </b>
                <small className="block mt-px text-[12px] text-ink-secondary">
                  {p && !p.is_active ? t("inactiveProduct") : t("orders30", { count: p?.orders_30d ?? 0 })}
                </small>
              </div>
              <div className="text-end text-[14px] font-bold whitespace-nowrap tabular-nums text-ink-primary">
                {pct === null ? "—" : fmtPct(pct)}
                {several && (
                  <>
                    <small className="block text-[11.5px] font-medium text-ink-secondary">
                      {`${fmtMoney(spendByProduct[l.product_id] ?? 0)} ${currency}`}
                    </small>
                    <span aria-hidden className="block w-[72px] h-1 mt-[5px] ms-auto rounded-sm bg-line-subtle overflow-hidden">
                      <b className="block h-full rounded-sm bg-ink-primary" style={{ width: `${pct ?? 0}%` }} />
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
      <div className="flex items-center gap-2 flex-wrap px-3.5 py-[9px] bg-surface-sunken border-t border-line-subtle text-[12px] text-ink-secondary">
        <Clock size={13} aria-hidden />
        <span>
          {several ? `${version.split_mode === "manual" ? t("footManual") : t("footAuto")} · ` : ""}
          {version.effective_from ? t("fromDate", { date: fmtDay(version.effective_from, locale) }) : t("sinceStart")}
          {" · "}
          {t("byWho", { who: version.created_by_name ?? "—", date: fmtDay(version.created_at, locale) })}
        </span>
        <span className="flex-1" />
        {versions.length > 1 && (
          <button type="button" onClick={onToggleHistory} aria-expanded={historyOpen} className="font-semibold text-ink-primary hover:underline">
            {historyOpen ? t("hideHistory") : t("history", { count: versions.length })}
          </button>
        )}
      </div>
      {historyOpen && versions.length > 1 && <History versions={versions} currentId={version.id} products={products} />}
    </div>
  );
}

function History({ versions, currentId, products }: { versions: MappingVersionDTO[]; currentId: string; products: Map<string, MappingProductDTO> }) {
  const t = useTranslations("adSpend.mapping");
  const locale = useLocale();
  return (
    <ol className="px-3.5 pt-0.5 pb-3 border-t border-line-subtle">
      {versions.map((v, i) => {
        const replaced = v.superseded_at !== null;
        const now = v.id === currentId;
        return (
          <li key={v.id} className="relative grid grid-cols-[14px_1fr] gap-2.5 pt-3">
            {i < versions.length - 1 && <span aria-hidden className="absolute start-[6px] top-7 -bottom-3 w-px bg-line" />}
            <span aria-hidden className={`mt-1 ms-0.5 w-2.5 h-2.5 rounded-full border-2 ${now ? "border-brand bg-brand" : "border-chart-line bg-surface-card"}`} />
            <div className="min-w-0">
              <div className="text-[12.5px] text-ink-secondary">
                <b className="font-semibold text-ink-primary">
                  {v.effective_from ? t("fromDate", { date: fmtDay(v.effective_from, locale) }) : t("sinceStart")}
                </b>
                {" · "}
                {t("byWho", { who: v.created_by_name ?? "—", date: fmtDay(v.created_at, locale) })}
                {replaced && v.superseded_at ? ` · ${t("replacedOn", { date: fmtDay(v.superseded_at, locale) })}` : null}
                {now && (
                  <span className="ms-1.5 px-1.5 py-px rounded-[4px] bg-brand-bg text-brand text-[10.5px] font-bold uppercase tracking-[0.03em]">
                    {t("inForce")}
                  </span>
                )}
              </div>
              <div className={`mt-[3px] flex items-center gap-1.5 min-w-0 text-[12.5px] ${replaced ? "opacity-55 line-through decoration-ink-muted" : ""}`}>
                <VersionLabel version={v} products={products} />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

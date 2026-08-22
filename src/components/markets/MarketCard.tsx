"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Sparkline } from "@/components/dashboard/charts/Sparkline";

export interface MarketRow {
  id: string;
  code: string;
  name: string;
  language?: string;
  currency?: string;
  direction?: string;
  is_active?: boolean;
}

export interface WindowStats {
  received: number;
  confirmed: number;
  delivered: number;
}

export interface MarketMetrics {
  market_id: string;
  window_7d: WindowStats;
  window_30d: WindowStats;
  orders_today: number;
  confirmation_rate_7d: number;
  delivery_rate_30d: number;
  agents_online: number;
  agents_active: number;
  storefronts_total: number;
  storefronts_active: number;
  carriers_total: number;
  carriers_active: number;
  last_order_at: string | null;
  spark_7d: number[];
}

export type MarketWindow = "7d" | "30d";

interface Props {
  market: MarketRow;
  metrics?: MarketMetrics;
  window: MarketWindow;
  locale: string;
  canEdit: boolean;
  onEdit: (m: MarketRow) => void;
}

const LANG_LABEL: Record<string, string> = { fr: "Français", ar: "العربية" };

function fmtDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-TN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function daysBetween(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
}

export function MarketCard({ market, metrics, window, locale, canEdit, onEdit }: Props) {
  const isActive = market.is_active ?? true;
  const isLy = market.code === "ly";
  const language = market.language ?? (isLy ? "ar" : "fr");
  const currency = market.currency ?? (isLy ? "LYD" : "TND");
  const direction = market.direction ?? (isLy ? "rtl" : "ltr");
  const dir = direction === "rtl" ? "rtl" : "ltr";

  const stats = (window === "7d" ? metrics?.window_7d : metrics?.window_30d) ?? {
    received: 0,
    confirmed: 0,
    delivered: 0,
  };
  const windowDays = window === "7d" ? 7 : 30;
  const windowLabel = window === "7d" ? "7 jours" : "30 jours";
  const perDay = stats.received > 0 ? Math.round(stats.received / windowDays) : 0;

  const sfTotal = metrics?.storefronts_total ?? 0;
  const sfActive = metrics?.storefronts_active ?? 0;
  const caTotal = metrics?.carriers_total ?? 0;
  const caActive = metrics?.carriers_active ?? 0;
  const connTotal = sfTotal + caTotal;
  const connActive = sfActive + caActive;

  const confPct = stats.received > 0 ? Math.round((stats.confirmed / stats.received) * 100) : 0;
  const delivPct = stats.confirmed > 0 ? Math.round((stats.delivered / stats.confirmed) * 100) : 0;

  // Health / status of the market, derived from real activity.
  const dormant = isActive && !!metrics && metrics.window_30d.received === 0 && !!metrics.last_order_at;
  const state: "off" | "dormant" | "ok" = !isActive ? "off" : dormant ? "dormant" : "ok";

  const banner =
    state === "off"
      ? { cls: "bg-status-warningBg text-status-warning", label: "Marché désactivé", icon: "warn" as const }
      : state === "dormant"
        ? { cls: "bg-surface-sunken text-ink-secondary", label: "En sommeil", icon: "moon" as const }
        : { cls: "bg-brand-tint text-status-success", label: "Sain", icon: "check" as const };

  const sparkData = (metrics?.spark_7d ?? []).map((v, i) => ({ value: v, day: `J-${6 - i}` }));
  const hasSpark = sparkData.some((d) => d.value > 0);

  return (
    <article
      className={`overflow-hidden rounded-[16px] border bg-surface-card shadow-hover-row ${
        state === "off" ? "border-status-warning/40" : state === "dormant" ? "border-line" : "border-status-success/30"
      }`}
    >
      {/* status banner */}
      <div className={`flex items-center justify-center gap-2 py-2 text-[12.5px] font-semibold ${banner.cls}`}>
        {banner.icon === "warn" && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[15px] w-[15px]"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
        )}
        {banner.icon === "moon" && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[15px] w-[15px]"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
        )}
        {banner.icon === "check" && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[15px] w-[15px]"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>
        )}
        {banner.label}
      </div>

      {/* header */}
      <div className="flex items-center gap-3 border-b border-line-subtle px-5 py-4">
        <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-ink-primary text-[13px] font-extrabold uppercase tracking-[0.05em] text-white">
          {market.code}
        </span>
        <div className="min-w-0">
          <h3 className="text-[16px] font-semibold text-ink-primary">{market.name}</h3>
          <p className="text-[12.5px] text-ink-secondary" dir={dir}>
            {currency} · {LANG_LABEL[language] ?? language} · {direction.toUpperCase()}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2.5">
          <Badge tone={isActive ? "success" : "neutral"} dot>{isActive ? "Actif" : "Inactif"}</Badge>
        </div>
      </div>

      {/* hero: orders + funnel */}
      <div className="grid grid-cols-1 border-b border-line-subtle sm:grid-cols-2">
        <div className="border-b border-line-subtle px-5 py-4 sm:border-b-0 sm:border-e">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-secondary">Commandes · {windowLabel}</div>
          <div className="mt-1.5 text-[32px] font-bold leading-none tabular-nums tracking-[-0.02em]">{stats.received}</div>
          <div className="mt-1 text-[12.5px] text-ink-secondary">
            {stats.received > 0 ? `${perDay} / jour · ${metrics?.orders_today ?? 0} aujourd'hui` : "aucune commande sur la période"}
          </div>
          {hasSpark && (
            <div className="mt-2 h-[42px]">
              <Sparkline data={sparkData} color="var(--brand)" showTooltip />
            </div>
          )}
        </div>
        <div className="px-5 py-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-secondary">Entonnoir · {windowLabel}</div>
          {stats.received > 0 ? (
            <>
              <div className="mt-2 flex h-11 items-stretch gap-[3px]">
                <FunnelSeg flex={stats.received} label={`${stats.received}`} sub="reçues" bg="var(--chart-line)" first />
                <FunnelSeg flex={Math.max(stats.confirmed, stats.received * 0.08)} label={`${stats.confirmed}`} sub="confirmées" bg="var(--brand)" />
                <FunnelSeg flex={Math.max(stats.delivered, stats.received * 0.06)} label={`${stats.delivered}`} sub="livrées" bg="var(--brand-pos)" last />
              </div>
              <div className="mt-2 flex gap-2">
                <span className="flex-1 rounded-md border border-line-subtle bg-surface-sunken px-2 py-1 text-center text-[12px] text-ink-secondary"><b className="text-ink-primary">{confPct} %</b> des reçues</span>
                <span className="flex-1 rounded-md border border-line-subtle bg-surface-sunken px-2 py-1 text-center text-[12px] text-ink-secondary"><b className="text-ink-primary">{delivPct} %</b> des confirmées</span>
              </div>
            </>
          ) : (
            <div className="mt-2 flex h-[70px] items-center justify-center rounded-md border border-dashed border-line bg-surface-sunken text-[12.5px] text-ink-muted">
              Aucune commande à suivre sur la période
            </div>
          )}
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-3 border-b border-line-subtle">
        <Cell label="Connexions" value={`${connActive}/${connTotal}`} sub={`${sfTotal} SF · ${caTotal} transp.`} />
        <Cell label="Agents en ligne" value={`${metrics?.agents_online ?? 0}`} sub={`/ ${metrics?.agents_active ?? 0} actifs`} border />
        <Cell label="Livraison 30 j" value={`${metrics?.delivery_rate_30d ?? 0} %`} sub={`${metrics?.window_30d.delivered ?? 0} livrées`} />
      </div>

      {/* insight */}
      <Insight state={state} market={market} metrics={metrics} stats={stats} windowLabel={windowLabel} locale={locale} />

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        {canEdit && (
          <Button variant="secondary" size="sm" onClick={() => onEdit(market)}>Modifier le marché</Button>
        )}
        <Link href={`/${locale}/system/connections`} className="inline-flex h-8 items-center rounded-lg border border-line-strong px-3 text-[13px] font-semibold text-ink-primary hover:bg-surface-hover">Connexions</Link>
        <Link href={`/${locale}/system/settings`} className="inline-flex h-8 items-center rounded-lg border border-line-strong px-3 text-[13px] font-semibold text-ink-primary hover:bg-surface-hover">Réglages</Link>
        <span className="ms-auto text-[12px] text-ink-muted">{sfTotal} storefronts · {caTotal} transporteurs</span>
      </div>
    </article>
  );
}

function Insight({
  state,
  market,
  metrics,
  stats,
  windowLabel,
  locale,
}: {
  state: "off" | "dormant" | "ok";
  market: MarketRow;
  metrics?: MarketMetrics;
  stats: WindowStats;
  windowLabel: string;
  locale: string;
}) {
  if (state === "off") {
    return (
      <div className="flex items-start gap-2.5 border-b border-line-subtle bg-status-warningBg px-5 py-3 text-[13px] text-status-warning">
        <Dot />
        <span>Marché désactivé — il n'apparaît plus dans les sélecteurs ni dans les files.</span>
      </div>
    );
  }
  if (state === "dormant" && metrics?.last_order_at) {
    const n = daysBetween(metrics.last_order_at);
    return (
      <div className="flex items-start gap-2.5 border-b border-line-subtle bg-surface-sunken px-5 py-3 text-[13px] text-ink-secondary">
        <Dot />
        <span>
          Dernière commande le <b className="text-ink-primary">{fmtDate(metrics.last_order_at, locale)}</b> — aucune activité depuis {n} jours. Marché en sommeil.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5 border-b border-line-subtle bg-brand-tint px-5 py-3 text-[13px] text-status-success">
      <Dot />
      <span className="text-ink-secondary">
        Sur {windowLabel} : <b className="text-ink-primary">{stats.received}</b> reçues, <b className="text-ink-primary">{stats.confirmed}</b> confirmées, <b className="text-ink-primary">{stats.delivered}</b> livrées.
        {" "}
        {market.code === "ly" ? "Le gros du volume arrive par synchronisation Google Sheets, pas par webhook." : null}
      </span>
    </div>
  );
}

function Dot() {
  return <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />;
}

function FunnelSeg({ flex, label, sub, bg, first, last }: { flex: number; label: string; sub: string; bg: string; first?: boolean; last?: boolean }) {
  const clip = first
    ? "polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%)"
    : last
      ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 9px 50%)"
      : "polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 9px 50%)";
  return (
    <div
      className="flex min-w-0 flex-col items-center justify-center overflow-hidden px-2.5 text-[13px] font-bold leading-none text-white"
      style={{ flex, background: bg, clipPath: clip, borderRadius: first ? "6px 0 0 6px" : last ? "0 6px 6px 0" : undefined }}
    >
      {label}
      <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.04em] opacity-90">{sub}</span>
    </div>
  );
}

function Cell({ label, value, sub, border }: { label: string; value: string; sub?: string; border?: boolean }) {
  return (
    <div className={`px-5 py-3 ${border ? "border-x border-line-subtle" : ""}`}>
      <div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-secondary">{label}</div>
      <div className="mt-0.5 text-[18px] font-bold tabular-nums tracking-[-0.01em]">{value}</div>
      {sub && <div className="text-[11.5px] text-ink-secondary">{sub}</div>}
    </div>
  );
}

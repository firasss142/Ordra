"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export interface MarketRow {
  id: string;
  code: string;
  name: string;
  language?: string;
  currency?: string;
  direction?: string;
  is_active?: boolean;
}

export interface MarketMetrics {
  market_id: string;
  orders_today: number;
  confirmed_today: number;
  confirmation_rate: number;
  agents_active: number;
}

interface Props {
  market: MarketRow;
  metrics?: MarketMetrics;
  locale: string;
  canEdit: boolean;
  onEdit: (m: MarketRow) => void;
}

const LANG_LABEL: Record<string, string> = { fr: "Français", ar: "العربية" };

export function MarketCard({ market, metrics, locale, canEdit, onEdit }: Props) {
  const orders = metrics?.orders_today ?? 0;
  const confirmed = metrics?.confirmed_today ?? 0;
  const rate = metrics?.confirmation_rate ?? 0;
  const agents = metrics?.agents_active ?? 0;
  const isActive = market.is_active ?? true;
  const attn = !isActive; // simple signal; richer health lands with Journaux
  // Fall back from the market's code when the row doesn't carry these (some
  // callers only select id/name/code): ly = Arabic/RTL/LYD, else fr/LTR/TND.
  const isLy = market.code === "ly";
  const language = market.language ?? (isLy ? "ar" : "fr");
  const currency = market.currency ?? (isLy ? "LYD" : "TND");
  const direction = market.direction ?? (isLy ? "rtl" : "ltr");
  const dir = direction === "rtl" ? "rtl" : "ltr";

  const confPct = orders > 0 ? Math.round((confirmed / orders) * 100) : 0;

  return (
    <article className={`overflow-hidden rounded-[16px] border bg-surface-card shadow-hover-row ${attn ? "border-status-warning/40" : "border-line-subtle"}`}>
      {/* status banner */}
      <div className={`flex items-center justify-center gap-2 py-2 text-[12.5px] font-semibold ${attn ? "bg-status-warningBg text-status-warning" : "bg-brand-tint text-status-success"}`}>
        {attn ? (
          <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[15px] w-[15px]"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>Marché désactivé</>
        ) : (
          <><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-[15px] w-[15px]"><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></svg>Actif</>
        )}
      </div>

      {/* header */}
      <div className="flex items-center gap-3 border-b border-line-subtle px-5 py-4">
        <span className="grid h-11 w-11 place-items-center rounded-[12px] bg-ink-primary text-[13px] font-extrabold uppercase tracking-[0.05em] text-white">
          {market.code}
        </span>
        <div>
          <h3 className="text-[16px] font-semibold text-ink-primary">{market.name}</h3>
          <p className="text-[12.5px] text-ink-secondary" dir={dir}>
            {currency} · {LANG_LABEL[language] ?? language} · {direction.toUpperCase()}
          </p>
        </div>
        <div className="ms-auto flex items-center gap-2.5">
          <Badge tone={isActive ? "success" : "neutral"} dot>{isActive ? "Actif" : "Inactif"}</Badge>
        </div>
      </div>

      {/* hero + funnel */}
      <div className="grid grid-cols-2 border-b border-line-subtle">
        <div className="border-e border-line-subtle px-5 py-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-secondary">Commandes · aujourd'hui</div>
          <div className="mt-1.5 text-[32px] font-bold leading-none tabular-nums tracking-[-0.02em]">{orders}</div>
          <div className="mt-1 text-[12.5px] text-ink-secondary">{confirmed} confirmées · {rate.toFixed(0)} %</div>
        </div>
        <div className="px-5 py-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-secondary">Entonnoir · aujourd'hui</div>
          <div className="mt-2 flex h-10 items-stretch gap-[3px]">
            <FunnelSeg flex={Math.max(orders, 1)} label={`${orders}`} sub="reçues" bg="var(--chart-line)" first />
            <FunnelSeg flex={Math.max(confirmed, 1)} label={`${confirmed}`} sub="confirmées" bg="var(--brand)" last />
          </div>
          <div className="mt-2 rounded-md border border-line-subtle bg-surface-sunken px-2 py-1 text-center text-[12px] text-ink-secondary">
            <b className="text-ink-primary">{confPct} %</b> des reçues
          </div>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-3 border-b border-line-subtle">
        <Cell label="Agents en ligne" value={`${agents}`} />
        <Cell label="Taux de confirmation" value={`${rate.toFixed(0)} %`} border />
        <Cell label="Devise" value={currency} />
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2 px-5 py-4">
        {canEdit && (
          <Button variant="secondary" size="sm" onClick={() => onEdit(market)}>Modifier le marché</Button>
        )}
        <Link href={`/${locale}/system/connections`} className="inline-flex h-8 items-center rounded-lg border border-line-strong px-3 text-[13px] font-semibold text-ink-primary hover:bg-surface-hover">Connexions</Link>
        <Link href={`/${locale}/system/settings`} className="inline-flex h-8 items-center rounded-lg border border-line-strong px-3 text-[13px] font-semibold text-ink-primary hover:bg-surface-hover">Réglages</Link>
        <Link href={`/${locale}/dashboard`} className="ms-auto text-[12.5px] text-status-action hover:underline">Tableau de bord →</Link>
      </div>
    </article>
  );
}

function FunnelSeg({ flex, label, sub, bg, first, last }: { flex: number; label: string; sub: string; bg: string; first?: boolean; last?: boolean }) {
  const clip = first
    ? "polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%)"
    : last
      ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 9px 50%)"
      : "polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%, 9px 50%)";
  return (
    <div
      className="flex flex-col items-center justify-center px-2.5 text-[13px] font-bold text-white"
      style={{ flex, background: bg, clipPath: clip, borderRadius: first ? "6px 0 0 6px" : last ? "0 6px 6px 0" : undefined }}
    >
      {label}
      <span className="text-[9px] font-semibold uppercase tracking-[0.04em] opacity-90">{sub}</span>
    </div>
  );
}

function Cell({ label, value, border }: { label: string; value: string; border?: boolean }) {
  return (
    <div className={`px-5 py-3 ${border ? "border-x border-line-subtle" : ""}`}>
      <div className="text-[10.5px] font-bold uppercase tracking-[0.07em] text-ink-secondary">{label}</div>
      <div className="mt-0.5 text-[18px] font-bold tabular-nums tracking-[-0.01em]">{value}</div>
    </div>
  );
}

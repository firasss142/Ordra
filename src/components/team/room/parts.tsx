"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { MessageCircle, Phone } from "lucide-react";
import { toWhatsAppE164 } from "@/lib/whatsapp/phone";
import type { MarketCode } from "@/lib/markets";

export type Presence = "working" | "idle" | "late" | "off" | null;

const DOT: Record<Exclude<Presence, null>, string> = {
  working: "bg-room-live",
  idle: "bg-room-amber-dot",
  late: "bg-room-amber-dot",
  off: "bg-room-ink-4",
};

/** Initial in a grey disc, with the presence dot when there is one to show. */
export function Avatar({ name, presence = null, size = 34, dark = false }: { name: string; presence?: Presence; size?: number; dark?: boolean }) {
  const dot = Math.round(size * 0.32);
  return (
    <span
      className={`relative grid flex-none place-items-center rounded-full font-semibold uppercase ${dark ? "bg-ink-primary text-white" : "bg-[#E7E9EC] text-[#3A3F44]"}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {name.slice(0, 1)}
      {presence && (
        <i
          className={`absolute -bottom-px -end-px rounded-full border-2 border-white ${DOT[presence]}`}
          style={{ width: dot, height: dot }}
        />
      )}
    </span>
  );
}

/** WhatsApp to the agent — or, with no number in Accès, a disabled button that says so. */
export function WhatsAppButton({ phone, market, variant = "icon" }: { phone: string | null; market: MarketCode; variant?: "icon" | "labelled" }) {
  const t = useTranslations("team.room.agents");
  const number = toWhatsAppE164(phone, market);
  const title = number ? t("wa") : t("waNone");
  if (variant === "labelled") {
    const cls = "inline-flex h-[28px] items-center gap-[6px] rounded-[8px] border border-line bg-surface-card px-[10px] text-[12.5px] font-medium";
    return number ? (
      <a href={`https://wa.me/${number}`} target="_blank" rel="noreferrer" title={title} onClick={(e) => e.stopPropagation()} className={`${cls} hover:border-line-strong hover:bg-room-hover`}>
        <MessageCircle size={15} strokeWidth={1.8} aria-hidden="true" />
        <span className="max-[900px]:hidden">WhatsApp</span>
      </a>
    ) : (
      <button type="button" disabled title={title} aria-label={title} className={`${cls} cursor-not-allowed text-room-ink-3 opacity-60`}>
        <MessageCircle size={15} strokeWidth={1.8} aria-hidden="true" />
        <span className="max-[900px]:hidden">WhatsApp</span>
      </button>
    );
  }
  const cls = "inline-grid h-[32px] w-[32px] place-items-center rounded-[9px] border border-line-subtle bg-white";
  return number ? (
    <a href={`https://wa.me/${number}`} target="_blank" rel="noreferrer" title={title} aria-label={title} onClick={(e) => e.stopPropagation()} className={`${cls} text-room-ink-2 hover:border-line-strong hover:text-ink-primary`}>
      <MessageCircle size={15} strokeWidth={1.8} aria-hidden="true" />
    </a>
  ) : (
    <button type="button" disabled title={title} aria-label={title} onClick={(e) => e.stopPropagation()} className={`${cls} cursor-not-allowed text-room-ink-4`}>
      <MessageCircle size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/** A plain call, for the panel header. */
export function CallButton({ phone }: { phone: string | null }) {
  const t = useTranslations("team.room.agents");
  const cls = "inline-grid h-[28px] w-[32px] place-items-center rounded-[8px] border border-line bg-surface-card";
  return phone ? (
    <a href={`tel:${phone}`} title={t("call")} aria-label={t("call")} className={`${cls} hover:border-line-strong hover:bg-room-hover`}>
      <Phone size={15} strokeWidth={1.8} aria-hidden="true" />
    </a>
  ) : (
    <button type="button" disabled title={t("waNone")} aria-label={t("call")} className={`${cls} cursor-not-allowed text-room-ink-4`}>
      <Phone size={15} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

/** The panel's small uppercase section label, with an optional reading at its end. */
export function SectionLabel({ icon, children, end }: { icon?: ReactNode; children: ReactNode; end?: ReactNode }) {
  return (
    <div className="mb-[11px] flex items-center gap-[6px] text-[10.5px] font-[650] uppercase tracking-[0.09em] text-room-ink-3 rtl:text-[12px] rtl:tracking-normal">
      {icon}
      {children}
      {end !== undefined && <span className="ms-auto text-[11.5px] font-medium normal-case tracking-normal">{end}</span>}
    </div>
  );
}

/** A legend swatch. */
export function Swatch({ className }: { className: string }) {
  return <i className={`inline-block h-[10px] w-[10px] rounded-[3px] ${className}`} aria-hidden="true" />;
}

/** The hatching for « non appelées > N h » — in the bar, the legend and nowhere else. */
export const HATCH_STYLE = {
  background: "repeating-linear-gradient(-45deg, var(--room-red-bg) 0 3px, var(--room-red-soft) 3px 5px)",
} as const;
export const HATCH_SMALL_STYLE = {
  background: "repeating-linear-gradient(-45deg, var(--room-red-bg) 0 2px, var(--room-red-soft) 2px 4px)",
} as const;

/** A card, as the prototype draws them: white, hairline, 12 px corners. */
export function RoomCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[12px] border border-line-subtle bg-surface-card ${className}`}>{children}</section>;
}

/** Band heading: « AUJOURD'HUI ── 27 sept. · 17:20 ─────── » */
export function Band({ title, meta, end }: { title: string; meta?: ReactNode; end?: ReactNode }) {
  return (
    <div className="mx-[2px] -mb-[2px] mt-[10px] flex flex-wrap items-center gap-[10px]">
      <h2 className="text-[11.5px] font-[650] uppercase tracking-[0.1em] text-room-ink-2 rtl:text-[14px] rtl:tracking-normal">{title}</h2>
      {meta !== undefined && <span className="text-[12.5px] text-room-ink-3 tabular-nums">{meta}</span>}
      <span className="h-px min-w-[20px] flex-1 bg-line-subtle" />
      {end}
    </div>
  );
}

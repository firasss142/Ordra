"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp } from "lucide-react";
import { getCarrierLogo } from "@/lib/carriers/carrier-logos";
import { fmtPoints } from "@/lib/carriers/scorecard/format";
import { rateTrend, type RateStatus, type Tone } from "@/lib/carriers/scorecard/view-model";
import type { ScorecardPeriod } from "@/lib/carriers/scorecard/types";
import "./carriers.css";

/**
 * Pieces shared by the three Transporteurs screens, sized in px from the
 * approved prototype (prototypes/transporteurs-v2.html) — the root font is
 * 14px, so rem utilities would come out 12.5 % small.
 */

export type LineTone = Tone | "prov";

const TONE_TEXT: Record<LineTone, string> = {
  ok: "text-tr-ok-ink",
  warn: "text-tr-warn-ink",
  bad: "text-tr-bad-ink",
  prov: "text-tr-ink-2",
};
const TONE_DOT: Record<LineTone, string> = {
  ok: "bg-tr-ok",
  warn: "bg-tr-warn",
  bad: "bg-tr-bad",
  prov: "bg-tr-ink-4",
};

export const RATE_TONE: Record<RateStatus, LineTone> = { ok: "ok", near: "warn", below: "bad", prov: "prov" };

/** A state is always a dot AND words — never colour alone. */
export function StatusLine({
  tone, children, title, className = "",
}: { tone: LineTone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-[6px] text-[12.5px] font-semibold leading-[1.3] ${TONE_TEXT[tone]} ${className}`}>
      <i aria-hidden className={`h-[8px] w-[8px] flex-none rounded-full ${TONE_DOT[tone]}`} />
      {children}
    </span>
  );
}

export function NowTag() {
  const t = useTranslations("carrierScorecard");
  return (
    <span className="ms-[6px] inline-flex items-center gap-[5px] text-[11px] font-semibold text-tr-ink-3">
      <i aria-hidden className="h-[6px] w-[6px] rounded-full bg-tr-ok" />
      {t("now")}
    </span>
  );
}

/** The grey pill at the end of a card head: « 30 j », « 90 j », « maintenant ». */
export function Pill({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <span className="tsc-pill ms-auto">
      {live ? <i aria-hidden className="tsc-live !h-[6px] !w-[6px]" /> : null}
      {children}
    </span>
  );
}

/** Digits stay left-to-right inside Arabic. */
export function Num({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={`tabular-nums [unicode-bidi:isolate] ${className}`}>
      {children}
    </bdi>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="tsc-sec">
      {children}
    </div>
  );
}

const CardTitleId = createContext<string | undefined>(undefined);

/** A card is a region named by its head (or by `label` when it has none). */
export function Card({ children, className = "", style, label }: { children: ReactNode; className?: string; style?: CSSProperties; label?: string }) {
  const id = useId();
  return (
    <CardTitleId.Provider value={id}>
      <section style={style} aria-labelledby={label ? undefined : id} aria-label={label}
        className={`tsc-card ${className}`}>
        {children}
      </section>
    </CardTitleId.Provider>
  );
}

export function CardHead({ title, pill }: { title: ReactNode; pill?: ReactNode }) {
  const id = useContext(CardTitleId);
  return (
    <div className="flex items-center gap-[8px] px-[22px] pt-[20px]">
      <h3 id={id} className="tsc-chead">{title}</h3>
      {pill}
    </div>
  );
}

/** The carrier logo on a white chip; a carrier without one gets its initial in its colour. */
export function CarrierLogo({ code, name, logoUrl, size = 44, radius = 12 }: { code: string; name: string; /** The account's own upload, which wins over the brand file. */ logoUrl?: string | null; size?: number; radius?: number }) {
  const src = getCarrierLogo(code, logoUrl);
  return (
    <span
      aria-hidden
      className="grid flex-none place-items-center overflow-hidden bg-white shadow-[0_0_0_2px_rgba(255,255,255,.9),0_6px_16px_rgba(16,24,40,.18)]"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- brand asset or upload, sized by its chip
        <img src={src} alt="" className={`h-full w-full ${code === "darb_assabil" && !logoUrl ? "object-cover" : "object-contain"}`} />
      ) : (
        <span className="text-[19px] font-bold text-[var(--c)]">{name.trim().charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

/** ▲ +3,2 pt / ▼ −1 pt / stable — against the period before; nothing when there is none. */
export function TrendChip({ period, locale, periodLong }: { period: ScorecardPeriod; locale: string; periodLong: string }) {
  const t = useTranslations("carrierScorecard.trend");
  const tr = rateTrend(period);
  if (!tr) return null;
  const vs = t("vs", { period: periodLong });
  if (tr.kind === "flat") {
    return <span title={vs} className="inline-flex h-[20px] items-center gap-[3px] whitespace-nowrap rounded-full bg-[rgba(15,23,40,.05)] px-[9px] text-[11.5px] font-bold text-tr-ink-2">{t("flat")}</span>;
  }
  const Icon = tr.kind === "up" ? ArrowUp : ArrowDown;
  return (
    <span title={vs} className={`inline-flex h-[20px] items-center gap-[3px] whitespace-nowrap rounded-full pe-[8px] ps-[6px] text-[11.5px] font-bold ${tr.kind === "up" ? "bg-[#DCFAE6] text-tr-ok-ink" : "bg-tr-bad-bg text-tr-bad-ink"}`}>
      <Icon size={12} strokeWidth={2.8} aria-hidden />
      <Num>{t(tr.kind, { points: fmtPoints(locale, tr.points) })}</Num>
    </span>
  );
}

/** The width of a box, for SVG charts drawn at their real size. */
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth || fallback);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return { ref, width };
}

/** Buttons in Aurore (§4.3) — glass secondary, brand primary; the look lives in carriers.css. */
export const btn = "tsc-btn";
export const btnSm = "tsc-btn tsc-btn--sm";
export const btnSmPri = "tsc-btn tsc-btn--sm tsc-btn--pri";
export const btnSmGhost = "tsc-btn tsc-btn--sm tsc-btn--ghost";

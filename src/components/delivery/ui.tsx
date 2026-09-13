"use client";

/**
 * Shared pieces of the delivery worklist, in the visual language of
 * prototypes/suivi-livraison-v1.html (v3). Functional colour is spent only on
 * bucket state — the edge, the dot and the situation chip — exactly as the
 * prototype does; everything else is black, white and grey.
 */
import { useTranslations } from "next-intl";
import type { Tone, Situation } from "@/lib/delivery/presentation";
import { dayPart } from "@/lib/delivery/presentation";

export const TONE: Record<Tone, { chip: string; edge: string; dot: string; soft: string }> = {
  red: { chip: "bg-[#FEE2E2] text-[#B91C1C]", edge: "before:bg-[#EF4444]", dot: "bg-[#EF4444]", soft: "bg-[#FEE2E2]" },
  amber: { chip: "bg-[#FEF3C7] text-[#92400E]", edge: "before:bg-[#F59E0B]", dot: "bg-[#F59E0B]", soft: "bg-[#FEF3C7]" },
  blue: { chip: "bg-[#DBEAFE] text-[#1D4ED8]", edge: "before:bg-[#3B82F6]", dot: "bg-[#3B82F6]", soft: "bg-[#DBEAFE]" },
  grey: { chip: "bg-[#F3F4F6] text-[#374151]", edge: "before:bg-[#9CA3AF]", dot: "bg-[#9CA3AF]", soft: "bg-[#F3F4F6]" },
  green: { chip: "bg-[#DCFCE7] text-[#15803D]", edge: "before:bg-[#22C55E]", dot: "bg-[#22C55E]", soft: "bg-[#DCFCE7]" },
};

/** The coloured inline-start edge on rows and cards. */
export const EDGE =
  "relative overflow-hidden before:absolute before:inset-y-0 before:start-0 before:w-1 before:content-['']";

export function Chip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${TONE[tone].chip}`}>
      {children}
    </span>
  );
}

/** Digits, phone numbers and ids stay left-to-right inside Arabic text. */
export function Ltr({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={`[unicode-bidi:isolate] tabular-nums ${className}`}>
      {children}
    </span>
  );
}

/** What every icon slot on the page accepts — lucide icons and WhatsAppIcon alike. */
export type IconComponent = React.ComponentType<{ size?: number | string; className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

export function WhatsAppIcon({ size = 18, className = "" }: { size?: number | string; className?: string; "aria-hidden"?: boolean | "true" | "false" }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={className}
      fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20l1.3-3.8A8 8 0 1 1 8.2 19z" />
      <path d="M9.2 9.6c.3 2.4 2.4 4.5 4.8 4.8l.9-1.4-1.7-1-1 .8a5.7 5.7 0 0 1-1.4-1.4l.8-1-1-1.7z" />
    </svg>
  );
}

/** "185 LYD" in French, "185 د.ل" in Arabic — the prototype's money line. */
export function moneyText(amount: number | null, market: "ly" | "tn", locale: string): string {
  const value = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 })
    .format(amount ?? 0)
    .replace(/ | /g, " ");
  const unit = locale === "ar" ? (market === "ly" ? "د.ل" : "د.ت") : market === "ly" ? "LYD" : "TND";
  return `${value} ${unit}`;
}

export function useDuration() {
  const t = useTranslations("delivery");
  return (hours: number) =>
    hours < 1
      ? t("minutes", { n: Math.max(1, Math.round(hours * 60)) })
      : hours < 24
        ? t("hours", { n: Math.round(hours) })
        : t("days", { n: Math.round(hours / 24) });
}

export function useSituationLabel() {
  const t = useTranslations("delivery");
  const duration = useDuration();
  return (s: Situation) => {
    const label = t(`sit.${s.key}`);
    return s.hours === null ? label : `${label} · ${duration(s.hours)}`;
  };
}

export function useSituationSub() {
  const t = useTranslations("delivery");
  return (s: Situation) => ("text" in s.sub ? s.sub.text : t(`subs.${s.sub.key}`));
}

/** "Aujourd'hui 09:12" / "Hier 14:20" / "10 sept. 14:20", on the market clock. */
export function useWhen(now: number, tz: string, locale: string) {
  const t = useTranslations("delivery");
  return (iso: string, short = false) => {
    const { day, time } = dayPart(iso, now, tz);
    if (day === "today") return short ? time : t("today", { time });
    if (day === "yesterday") return short ? t("yesterday", { time: "" }).trim() : t("yesterday", { time });
    const date = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", {
      timeZone: tz, day: "numeric", month: "short",
    }).format(new Date(iso));
    return short ? date : `${date} ${time}`;
  };
}

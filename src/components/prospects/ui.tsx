"use client";

/**
 * Shared pieces of « Prospects ». Functional colour is spent only on the
 * bucket — the row's edge, the dot, the situation chip and the action bar —
 * everything else is black, white and grey, with the brand green on the one
 * primary button and on WhatsApp.
 *
 * Design: prototypes/prospects-v3.html. The delivery worklist has an
 * equivalent file; the two are deliberately separate copies, because a
 * prospect has a violet campaign tone that a parcel has no use for.
 */
import { useTranslations } from "next-intl";
import { Calendar, Clock, Megaphone, Phone, RotateCcw, ShoppingCart } from "lucide-react";
import type { SituationKey, Tone } from "@/lib/prospects/presentation";

export const TONE: Record<Tone, { chip: string; edge: string; dot: string; soft: string; border: string; icon: string }> = {
  amber: { chip: "bg-[#FEF3C7] text-[#92400E]", edge: "before:bg-[#F59E0B]", dot: "bg-[#F59E0B]", soft: "bg-[#FEF3C7]", border: "border-[#FBBF24]", icon: "text-[#B45309]" },
  blue: { chip: "bg-[#DBEAFE] text-[#1D4ED8]", edge: "before:bg-[#3B82F6]", dot: "bg-[#3B82F6]", soft: "bg-[#DBEAFE]", border: "border-[#93C5FD]", icon: "text-[#1D4ED8]" },
  grey: { chip: "bg-[#F3F4F6] text-[#374151]", edge: "before:bg-[#9CA3AF]", dot: "bg-[#9CA3AF]", soft: "bg-[#F3F4F6]", border: "border-[#D1D5DB]", icon: "text-[#374151]" },
  violet: { chip: "bg-[#EDE9FE] text-[#5B21B6]", edge: "before:bg-[#8B5CF6]", dot: "bg-[#8B5CF6]", soft: "bg-[#EDE9FE]", border: "border-[#C4B5FD]", icon: "text-[#6D28D9]" },
  red: { chip: "bg-[#FEE2E2] text-[#B91C1C]", edge: "before:bg-[#EF4444]", dot: "bg-[#EF4444]", soft: "bg-[#FEE2E2]", border: "border-[#F87171]", icon: "text-[#DC2626]" },
  green: { chip: "bg-[#DCFCE7] text-[#15803D]", edge: "before:bg-[#22C55E]", dot: "bg-[#22C55E]", soft: "bg-[#DCFCE7]", border: "border-[#86EFAC]", icon: "text-[#15803D]" },
};

/** The coloured inline-start edge on rows and cards. */
export const EDGE =
  "relative overflow-hidden before:absolute before:inset-y-0 before:start-0 before:w-1 before:content-['']";

export type IconComponent = React.ComponentType<{
  size?: number | string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  strokeWidth?: number | string;
}>;

/** The glyph inside the situation chip: a clock for anything timed. */
export const SIT_ICON: Record<SituationKey, IconComponent> = {
  hot: Clock,
  callback_due: Clock,
  callback_at: Calendar,
  retry: Phone,
  campaign: Megaphone,
  winback: RotateCcw,
  converted: ShoppingCart,
};

/** The situation chip: a glyph on desktop, the phone design's plain dot below it. */
export function Chip({ tone, icon: Icon, children }: { tone: Tone; icon?: IconComponent; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-1 pe-3 ps-2.5 text-[13px] font-semibold ${TONE[tone].chip}`}>
      {Icon ? <Icon size={14} aria-hidden className="hidden shrink-0 lg:block" /> : null}
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full lg:hidden ${TONE[tone].dot}`} />
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

export function WhatsAppIcon({ size = 18, className = "" }: { size?: number | string; className?: string; "aria-hidden"?: boolean | "true" | "false"; strokeWidth?: number | string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={className}
      fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20l1.3-3.8A8 8 0 1 1 8.2 19z" />
      <path d="M9.2 9.6c.3 2.4 2.4 4.5 4.8 4.8l.9-1.4-1.7-1-1 .8a5.7 5.7 0 0 1-1.4-1.4l.8-1-1-1.7z" />
    </svg>
  );
}

/** "110 LYD" in French, "110 د.ل" in Arabic. */
export function moneyText(amount: number | null, market: "ly" | "tn", locale: string): string {
  const value = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 })
    .format(amount ?? 0)
    .replace(/ | /g, " ");
  const unit = locale === "ar" ? (market === "ly" ? "د.ل" : "د.ت") : market === "ly" ? "LYD" : "TND";
  return `${value} ${unit}`;
}

/**
 * An amount with its unit, number first in reading order whatever the script.
 * Plain text would let the bidi algorithm decide, and it decides wrong.
 */
export function Money({ amount, market, locale, className = "" }: { amount: number | null; market: "ly" | "tn"; locale: string; className?: string }) {
  const [value, unit] = moneyText(amount, market, locale).split(/ (?=[^ ]+$)/);
  return (
    <span className={`inline-flex items-baseline gap-1 whitespace-nowrap ${className}`}>
      <span dir="ltr" className="tabular-nums">{value}</span>{" "}<span>{unit}</span>
    </span>
  );
}

/** The green, white-on-brand primary of the page. */
export const PRIMARY_BTN =
  "inline-flex items-center justify-center gap-2.5 rounded-lg bg-[#15803D] font-semibold text-white hover:bg-[#166534] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]/40 disabled:opacity-50";

/** The white outlined secondary, its border coloured by `TONE[..].border`. */
export const OUTLINE_BTN =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border bg-white font-semibold text-[#111827] hover:bg-[#F9FAFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]/30";

/** "il y a 23 min" / "منذ ٢٣ د" — the prototype's one relative duration. */
export function useDuration() {
  const t = useTranslations("prospects");
  return (minutes: number) =>
    minutes < 60
      ? t("minutes", { n: Math.max(0, Math.round(minutes)) })
      : minutes < 1440
        ? t("hours", { n: Math.round(minutes / 60) })
        : t("days", { n: Math.round(minutes / 1440) });
}

/**
 * The situation chip's text: the label, plus whatever number that particular
 * situation counts — minutes for a hot prospect, the attempt for a retry, the
 * time for a callback that is still ahead.
 */
export function useSituationLabel(tz: string, locale: string) {
  const t = useTranslations("prospects");
  const duration = useDuration();
  return (s: { key: SituationKey; minutes: number | null; at: string | null; attempts: number; orderRef: string | null }) => {
    switch (s.key) {
      case "hot":
        return `${t("sit.hot")} · ${duration(s.minutes ?? 0)}`;
      case "callback_due":
        return `${t("sit.callback_due")} · ${duration(s.minutes ?? 0)}`;
      case "callback_at":
        return t("sit.callback_at", { time: s.at ? timeOnMarketClock(s.at, tz, locale) : "" });
      case "retry":
        return t("sit.retry", { n: s.attempts });
      case "converted":
        return s.orderRef ? t("sit.converted", { ref: s.orderRef }) : t("sit.converted_plain");
      default:
        return t(`sit.${s.key}`);
    }
  };
}

/** The grey line under the chip: a translated sentence, or someone's own words. */
export function useSituationSub() {
  const t = useTranslations("prospects");
  return (sub: { key: string } | { text: string }) =>
    "text" in sub ? sub.text : t.has(`subs.${sub.key}`) ? t(`subs.${sub.key}`) : "";
}

/** "14:30" on the market's clock, whatever the browser's timezone says. */
export function timeOnMarketClock(iso: string, tz: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(iso));
}

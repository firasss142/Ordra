"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { dayPart } from "@/lib/delivery/presentation";

/** « 12 min » · « 3 h » · « 2 j » (prototype durText). */
export function useDur() {
  const t = useTranslations("agentDelivery.dur");
  return useCallback((m: number) => (m < 60 ? t("min", { n: m }) : m < 1440 ? t("h", { n: Math.floor(m / 60) }) : t("d", { n: Math.floor(m / 1440) })), [t]);
}

/** « Aujourd'hui 09:12 » · « Hier 14:20 » · « 4 oct. 17:20 » on the market's clock. */
export function useDayWhen(tz: string, now: number, locale: string) {
  const t = useTranslations("agentDelivery.when");
  return useCallback(
    (iso: string | null | undefined) => {
      if (!iso) return "";
      const { day, time } = dayPart(iso, now, tz);
      if (day === "today") return t("today", { time });
      if (day === "yesterday") return t("yday", { time });
      const d = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { timeZone: tz, day: "numeric", month: "short" }).format(new Date(iso));
      return t("other", { day: d, time });
    },
    [t, tz, now, locale],
  );
}

/** The amount as the prototype writes it (fnum): grouped, no decimals in Libya, three in Tunisia. */
export function fnum(n: number | null | undefined, market: "ly" | "tn"): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: market === "tn" ? 3 : 0 })
    .format(n ?? 0)
    .replace(/[\s  ]/g, " ");
}

/** The amount with its currency, as plain text (« 185 LYD »). */
export function useMoneyText(market: "ly" | "tn") {
  const t = useTranslations("agentDelivery");
  return useCallback((n: number | null | undefined) => `${fnum(n, market)} ${t(`ccy.${market}`)}`, [t, market]);
}

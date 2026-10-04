"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { fmtCommission } from "@/lib/commissions/view-models";
import { hm } from "@/lib/team/room/time";

/** Latin digits in Arabic, as the rest of the console writes them. */
export function intlLocale(locale: string): string {
  return locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR";
}

/**
 * Every number, duration and date the control room prints. One place, so the
 * strip, the rows and the panel cannot disagree on how « 4 h 06 » is written.
 */
export function useRoomFormat(locale: string, marketCode: string) {
  const t = useTranslations("team.room.dur");
  return useMemo(() => {
    const L = intlLocale(locale);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dayFmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(L, { timeZone: "UTC", ...opts });
    const fShort = dayFmt({ weekday: "short", day: "numeric", month: "short" });
    const fLong = dayFmt({ weekday: "long", day: "numeric", month: "long" });
    const fNum = dayFmt({ day: "numeric", month: "short" });
    const fDay = dayFmt({ day: "numeric" });
    const fMonth = dayFmt({ month: "long", year: "numeric" });
    const noon = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    const num = new Intl.NumberFormat(L);

    return {
      hm,
      /** 45 → "45 min", 246 → "4 h 06", 4600 → "3 j 4 h" */
      dur(min: number): string {
        const m = Math.max(0, Math.round(min));
        if (m < 60) return t("min", { n: m });
        if (m < 1440) {
          const h = Math.floor(m / 60);
          const r = m % 60;
          return r ? t("hm", { h, m: pad(r) }) : t("h", { h });
        }
        const d = Math.floor(m / 1440);
        const h = Math.floor((m % 1440) / 60);
        return h ? t("dh", { d, h }) : t("d", { d });
      },
      /** Arabic writes "56%" with no space: with one, Chrome flips the sign inside an RTL line. */
      pct(v: number | null | undefined): string {
        if (v === null || v === undefined || !Number.isFinite(v)) return "—";
        return `${Math.round(v)}${locale === "ar" ? "%" : " %"}`;
      },
      num: (n: number) => num.format(n),
      money: (n: number) => fmtCommission(Math.round(n), marketCode),
      dayShort: (iso: string) => fShort.format(noon(iso)),
      dayLong: (iso: string) => fLong.format(noon(iso)),
      dayNum: (iso: string) => fNum.format(noon(iso)),
      dayOfMonth: (iso: string) => fDay.format(noon(iso)),
      month: (ym: string) => fMonth.format(noon(`${ym}-15`)),
    };
  }, [locale, marketCode, t]);
}

export type RoomFormat = ReturnType<typeof useRoomFormat>;

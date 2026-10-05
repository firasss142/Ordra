import { marketTimezone } from "@/lib/markets";
import { marketToday } from "@/lib/warehouse/day-loop-server";

/**
 * The two dates every Entrepôt desk header needs: « lundi 5 octobre » in the
 * reader's language, and the market's own YYYY-MM-DD — both in the market's
 * time zone, never the server's.
 */
export function deskDates(locale: string, marketId: string | null, now = new Date()) {
  const dateLabel = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: marketTimezone(marketId),
  }).format(now);
  return { dateLabel, today: marketToday(marketId, now) };
}

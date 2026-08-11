import type { useTranslations } from "next-intl";
import { ALERT_TYPES, type AlertType } from "@/lib/alerts/catalogue";
import type { Alert } from "@/lib/alerts/types";

export type AlertsTranslator = ReturnType<typeof useTranslations<"alerts">>;

const LIVE_TYPES = new Set<string>(ALERT_TYPES);

/**
 * The human name for an alert type, safe for types that no longer exist.
 *
 * `alert_acknowledgements` is a permanent log: it still holds `low_stock` and
 * `agent_inactive` rows written before those rules were retired, and their
 * message keys are gone. next-intl renders a missing key as its own path, so
 * the history panel would print `alerts.types.low_stock.label` at the user.
 */
export function typeLabel(type: string, t: AlertsTranslator): string {
  if (!LIVE_TYPES.has(type)) return type;
  return t(`types.${type as AlertType}.label`);
}

const HOUR = 60;
const DAY = 24 * HOUR;

/**
 * How long something has been waiting, at a precision that coarsens as the
 * number grows.
 *
 * The panel used to print "bloquée 1176 h" and "en retard de 744 h 5 min". Both
 * are technically correct and neither is readable: nobody converts 1176 hours to
 * seven weeks in their head, and five minutes of precision on a month-old alert
 * is noise dressed as rigour. The ladder below keeps precision exactly where it
 * changes a decision — minutes in the first hour, the odd hour in the first
 * week — and drops it once the only useful reading is "this is very old".
 */
export function formatDuration(minutes: number, t: AlertsTranslator): string {
  const safe = Math.max(0, Math.floor(minutes));

  if (safe < HOUR) return t("minutesShort", { count: safe });

  if (safe < DAY) {
    const hours = Math.floor(safe / HOUR);
    const rem = safe % HOUR;
    return rem === 0
      ? t("hoursShort", { count: hours })
      : `${t("hoursShort", { count: hours })} ${t("minutesShort", { count: rem })}`;
  }

  const days = Math.floor(safe / DAY);
  // Past a week the leftover hour tells you nothing you would act on.
  if (days >= 7) return t("daysShort", { count: days });

  const rem = Math.floor((safe % DAY) / HOUR);
  return rem === 0
    ? t("daysShort", { count: days })
    : `${t("daysShort", { count: days })} ${t("hoursShort", { count: rem })}`;
}

/**
 * The right-hand reading on an alert row: one phrase per type, all of them
 * sharing the duration ladder above so two rows can be compared by eye.
 */
export function formatMeta(alert: Alert, t: AlertsTranslator): string {
  const key = `meta.${alert.type}` as const;

  if (alert.type === "stock_depleted") return t(key);

  const value = formatDuration(alert.age_minutes, t);

  if (alert.type === "attempts_stalled") {
    return t(key, { value, count: Number(alert.meta?.attempts ?? 0) });
  }

  return t(key, { value });
}

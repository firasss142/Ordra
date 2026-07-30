import type { useTranslations } from "next-intl";
import type { Alert } from "@/app/api/alerts/summary/route";

export type AlertsTranslator = ReturnType<typeof useTranslations<"alerts">>;

export function formatMeta(alert: Alert, t: AlertsTranslator): string {
  const { type, meta } = alert;
  const value = meta.value;
  switch (type) {
    case "overdue_callback":
      return t("meta.overdueBy", { value: formatMinutes(value, t) });
    case "unassigned_overflow":
      return t("meta.ageSuffix", { value: formatMinutes(value, t) });
    case "dispatch_failure":
      return t("meta.stuckHours", { hours: value });
    case "carrier_webhook_stale":
      return t("meta.stuckDays", { days: value });
    case "return_bottleneck":
      return t("meta.pendingReturns", { count: value });
    case "low_stock":
      return t("meta.remaining", { count: value });
    case "stock_depleted":
      return t("meta.depleted");
    case "agent_inactive":
      return t("meta.inactiveFor", { value: formatMinutes(value, t) });
    default:
      return "";
  }
}

export function formatMinutes(minutes: number, t: AlertsTranslator): string {
  if (minutes < 60) return t("minutesShort", { count: minutes });
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return t("hoursShort", { count: hours });
  return `${t("hoursShort", { count: hours })} ${t("minutesShort", { count: rem })}`;
}

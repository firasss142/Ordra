"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Calendar } from "lucide-react";

export interface AlertBannersProps {
  /** Display-name locale for date formatting. */
  locale: "ar" | "fr";
  /** True when the order is in a state where inline-edit is blocked. */
  editBlocked: boolean;
  /** Callback scheduled banner (only when status === callback_scheduled). */
  callbackScheduledAt: string | null;
  /** Dispatch scheduled banner (only when status === dispatch_scheduled). */
  dispatchScheduledAt: string | null;
  /** True when the scheduled dispatch will auto-fire at the chosen time. */
  dispatchScheduledAuto: boolean;
  /** Whether the cancel-schedule action is currently in flight. */
  cancelingSchedule: boolean;
  onCancelSchedule: () => void;
}

/**
 * Inline alert strip rendered between the hero card and the body sections.
 * Surfaces edit-blocked + callback-scheduled + dispatch-scheduled state.
 * The cancel-schedule pill stays here (in addition to the overflow menu) so
 * it's a single click from where the user is looking.
 */
export function AlertBanners({
  locale,
  editBlocked,
  callbackScheduledAt,
  dispatchScheduledAt,
  dispatchScheduledAuto,
  cancelingSchedule,
  onCancelSchedule,
}: AlertBannersProps) {
  const t = useTranslations("orders.detail");

  function formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString(locale === "ar" ? "ar-LY" : "fr-TN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  if (!editBlocked && !callbackScheduledAt && !dispatchScheduledAt) return null;

  return (
    <div className="flex flex-col gap-0">
      {editBlocked && (
        <div className="flex items-start gap-2 px-4 py-2.5 bg-surface-page border-y border-line-subtle text-[12px] text-ink-secondary">
          <AlertTriangle
            size={13}
            strokeWidth={2}
            className="flex-shrink-0 mt-0.5 text-status-warning"
            aria-hidden="true"
          />
          <span>{t("editBlockedStatus")}</span>
        </div>
      )}

      {callbackScheduledAt && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-status-actionBg border-b border-status-action/15 text-[12px] text-status-action">
          <Calendar size={13} strokeWidth={2} className="flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold">{t("scheduledCallbackBanner")}</span>
            <span className="text-status-action/70 ms-2 tabular-nums">
              {formatDateTime(callbackScheduledAt)}
            </span>
          </div>
        </div>
      )}

      {dispatchScheduledAt && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 bg-status-actionBg border-b border-status-action/15 text-[12px] text-status-action">
          <Calendar size={13} strokeWidth={2} className="flex-shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold">
              {dispatchScheduledAuto
                ? t("scheduledDispatchAutoBanner")
                : t("scheduledDispatchBanner")}
            </span>
            <span className="text-status-action/70 ms-2 tabular-nums">
              {formatDateTime(dispatchScheduledAt)}
            </span>
          </div>
          <button
            type="button"
            disabled={cancelingSchedule}
            onClick={onCancelSchedule}
            className="flex-shrink-0 text-[11px] font-medium text-status-action border border-status-action/30 rounded-md px-2 py-1 hover:bg-status-action/10 transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {cancelingSchedule ? t("scheduledDispatchCanceling") : t("scheduledDispatchCancel")}
          </button>
        </div>
      )}
    </div>
  );
}

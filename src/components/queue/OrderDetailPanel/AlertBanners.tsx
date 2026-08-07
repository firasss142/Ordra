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
  /** No delivery city resolved — carrier upload cannot proceed. */
  cityUnmatched?: boolean;
  /** Opens the city picker so the blocker can be cleared where it is reported. */
  onResolveCity?: () => void;
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
  cityUnmatched = false,
  onResolveCity,
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

  if (!editBlocked && !callbackScheduledAt && !dispatchScheduledAt && !cityUnmatched) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 px-[18px] pb-1 pt-3.5">
      {/* Blockers lead. Something that stops the order moving should be the
          first thing read, not a consequence discovered later in the log. */}
      {cityUnmatched && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-[10px] border border-oms-warn/25 bg-oms-warn-bg px-3 py-[11px]"
        >
          <AlertTriangle
            size={15}
            strokeWidth={2}
            className="flex-none text-oms-warn"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <b className="block text-[12.5px] font-[650] leading-[1.35] text-oms-warn">
              {t("blockerCity")}
            </b>
            <p className="m-0 mt-0.5 text-[12px] leading-[1.4] text-oms-ink-2">
              {t("blockerCityBody")}
            </p>
          </div>
          {onResolveCity && (
            <button
              type="button"
              onClick={onResolveCity}
              className="h-7 flex-none whitespace-nowrap rounded-[8px] border border-oms-warn/40 px-[11px] text-[11.5px] font-[650] text-oms-warn transition-colors duration-fast hover:bg-oms-warn/10"
            >
              {t("blockerResolve")}
            </button>
          )}
        </div>
      )}

      {editBlocked && (
        <div
          role="status"
          className="flex items-center gap-2.5 rounded-[10px] border border-oms-border bg-oms-sunken px-3 py-[11px] text-[12px] text-oms-ink-2"
        >
          <AlertTriangle
            size={14}
            strokeWidth={2}
            className="flex-none text-oms-warn"
            aria-hidden="true"
          />
          <span>{t("editBlockedStatus")}</span>
        </div>
      )}

      {callbackScheduledAt && (
        <div className="flex items-center gap-2.5 rounded-[10px] border border-oms-accent/20 bg-oms-accent-bg px-3 py-[11px] text-[12px] text-oms-accent-ink">
          <Calendar size={14} strokeWidth={2} className="flex-none" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <span className="font-[650]">{t("scheduledCallbackBanner")}</span>
            <span className="ms-2 tabular-nums opacity-75">
              {formatDateTime(callbackScheduledAt)}
            </span>
          </div>
        </div>
      )}

      {dispatchScheduledAt && (
        <div className="flex items-center gap-2.5 rounded-[10px] border border-oms-accent/20 bg-oms-accent-bg px-3 py-[11px] text-[12px] text-oms-accent-ink">
          <Calendar size={14} strokeWidth={2} className="flex-none" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <span className="font-[650]">
              {dispatchScheduledAuto
                ? t("scheduledDispatchAutoBanner")
                : t("scheduledDispatchBanner")}
            </span>
            <span className="ms-2 tabular-nums opacity-75">
              {formatDateTime(dispatchScheduledAt)}
            </span>
          </div>
          <button
            type="button"
            disabled={cancelingSchedule}
            onClick={onCancelSchedule}
            className="h-7 flex-none whitespace-nowrap rounded-[8px] border border-oms-accent/30 px-[11px] text-[11.5px] font-[650] transition-colors duration-fast hover:bg-oms-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cancelingSchedule ? t("scheduledDispatchCanceling") : t("scheduledDispatchCancel")}
          </button>
        </div>
      )}
    </div>
  );
}

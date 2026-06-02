"use client";

import { useLocale, useTranslations } from "next-intl";
import { useDarbStatus } from "@/hooks/useDarbStatus";
import { Button } from "@/components/ui/Button";
import { formatLongDate, formatTime } from "@/lib/format";

interface DarbStatusSectionProps {
  orderId: string;
  enabled: boolean;
}

/**
 * Darb Assabil carrier-side status for the order detail panel (Libya, RTL).
 *
 * Renders the live shipment timeline (append-only Arabic events straight from
 * the carrier API). Read-only — never mutates OMS state. Mirrors the container
 * styling of DexpressStatusSection so both carriers feel consistent, but uses a
 * chronological event list instead of Dexpress's reconstructed lifecycle
 * pipeline (Darb gives us real events; Dexpress only gives a single status).
 */
export function DarbStatusSection({ orderId, enabled }: DarbStatusSectionProps) {
  const t = useTranslations("darbStatus");
  const locale = useLocale();
  const { timeline, isLoading, error, refresh } = useDarbStatus(orderId, enabled);

  if (!enabled) return null;

  const Title = (
    <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-secondary mb-2">
      {t("sectionTitle")}
    </div>
  );

  // Loading
  if (isLoading || (!timeline && !error)) {
    return (
      <div className="px-5 py-3 border-b border-line-subtle bg-surface-card">
        {Title}
        <div
          role="status"
          aria-busy="true"
          aria-label={t("loading")}
          className="h-5 w-40 rounded bg-surface-hover animate-pulse"
        />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="px-5 py-3 border-b border-line-subtle bg-surface-card">
        {Title}
        <div role="alert" className="flex items-center gap-3 text-[13px] text-status-critical">
          <span>{t("loadError")}</span>
          <Button variant="secondary" size="sm" onClick={() => refresh()}>
            {t("retry")}
          </Button>
        </div>
      </div>
    );
  }

  // Empty timeline — carrier has the shipment but no events yet (or not found).
  if (!timeline || timeline.length === 0) {
    return (
      <div className="px-5 py-3 border-b border-line-subtle bg-surface-card">
        {Title}
        <div className="text-[13px] text-ink-secondary">{t("noEvents")}</div>
      </div>
    );
  }

  // Newest first for the panel (API returns oldest-first).
  const events = [...timeline].reverse();

  return (
    <div className="px-5 py-3 border-b border-line-subtle bg-surface-card">
      <div className="flex items-center justify-between mb-2">
        {Title}
        <Button variant="ghost" size="sm" onClick={() => refresh()}>
          {t("refresh")}
        </Button>
      </div>

      <ol className="relative ms-1.5 border-s border-line ps-4 space-y-3">
        {events.map((ev, i) => {
          const isCurrent = i === 0;
          return (
            <li key={`${ev.timestamp}-${i}`} className="relative">
              {/* Node dot on the timeline rail. */}
              <span
                aria-hidden="true"
                className={[
                  "absolute -start-[21px] top-1 h-2.5 w-2.5 rounded-full border",
                  isCurrent
                    ? "bg-ink-primary border-ink-primary"
                    : "bg-surface-card border-line-strong",
                ].join(" ")}
              />
              <div
                dir="rtl"
                lang="ar"
                className={[
                  "text-[13px] leading-tight",
                  isCurrent ? "font-medium text-ink-primary" : "text-ink-secondary",
                ].join(" ")}
              >
                {ev.labelAr || t("eventFallback")}
              </div>
              {ev.timestamp && (
                <div className="mt-0.5 text-[11px] text-ink-muted tabular-nums">
                  {formatLongDate(ev.timestamp, locale)}, {formatTime(ev.timestamp, locale)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

"use client";

import { useState, useRef, useId } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Star, AlertTriangle, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { useCustomerHistory } from "@/hooks/useCustomerHistory";
import { formatDateTime } from "@/lib/format";
import type { RepeatKind } from "@/lib/customer-history/classify";

export interface RepeatBuyerBadgeProps {
  source: "order" | "lead";
  sourceId: string;
  repeatKind: RepeatKind;
  priorOrderCount: number;
  priorLeadCount: number;
  priorRejectedCount: number;
  /** Optional: if provided and the source is an order, "See all orders" deep-links to filtered orders. */
  customerPhone?: string | null;
  locale?: string;
}

const TONE_BY_KIND: Record<Exclude<RepeatKind, "none">, "action" | "neutral" | "critical"> = {
  repeat: "action",
  likely: "neutral",
  risk: "critical",
};

export function RepeatBuyerBadge(props: RepeatBuyerBadgeProps) {
  const {
    source,
    sourceId,
    repeatKind,
    priorOrderCount,
    priorLeadCount,
    priorRejectedCount,
  } = props;

  const t = useTranslations("customerHistory");
  const tStatuses = useTranslations("orders.statuses");
  const locale = useLocale();
  const popoverId = useId();

  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { detail, isLoading, error } = useCustomerHistory(source, sourceId, open);

  if (repeatKind === "none") return null;

  const tone = TONE_BY_KIND[repeatKind];
  const label =
    repeatKind === "risk"
      ? t("badge.risk", { count: priorRejectedCount })
      : repeatKind === "likely"
        ? t("badge.likely", {
            count: Math.max(priorOrderCount, priorLeadCount),
          })
        : t("badge.repeat", { count: priorOrderCount });

  const Icon = repeatKind === "risk" ? AlertTriangle : Star;

  function handleEnter() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function handleLeave() {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }
  function stop(e: React.MouseEvent) {
    e.stopPropagation();
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      onClick={stop}
    >
      <Badge
        tone={tone}
        data-repeat-kind={repeatKind}
        aria-describedby={open ? popoverId : undefined}
        tabIndex={0}
        className={[
          "cursor-default select-none",
          repeatKind === "likely" ? "border border-dashed border-line-strong" : "",
        ].join(" ")}
      >
        <Icon size={11} strokeWidth={2.25} aria-hidden="true" />
        {label}
      </Badge>
      {open && (
        <PopoverPanel
          id={popoverId}
          repeatKind={repeatKind}
          priorOrderCount={priorOrderCount}
          priorLeadCount={priorLeadCount}
          isLoading={isLoading}
          error={!!error}
          detail={detail}
          locale={locale}
          tStatuses={tStatuses}
          customerPhone={props.customerPhone ?? null}
        />
      )}
    </span>
  );
}

interface PopoverPanelProps {
  id: string;
  repeatKind: Exclude<RepeatKind, "none">;
  priorOrderCount: number;
  priorLeadCount: number;
  isLoading: boolean;
  error: boolean;
  detail: ReturnType<typeof useCustomerHistory>["detail"];
  locale: string;
  tStatuses: ReturnType<typeof useTranslations>;
  customerPhone: string | null;
}

function PopoverPanel({
  id,
  repeatKind,
  priorOrderCount,
  priorLeadCount,
  isLoading,
  error,
  detail,
  locale,
  tStatuses,
  customerPhone,
}: PopoverPanelProps) {
  const t = useTranslations("customerHistory.popover");

  const stats = detail?.stats;
  const orders = detail?.orders ?? [];
  const leads = detail?.leads ?? [];

  const headline =
    repeatKind === "risk" && stats
      ? t("headlineRisk", {
          rejected: stats.rejected_count,
          total: stats.total_orders,
        })
      : t("headlineRepeat", {
          count: stats?.total_orders ?? priorOrderCount,
          delivered: stats?.delivered_count ?? 0,
        });

  const seeAllHref = customerPhone
    ? `/${locale}/orders?q=${encodeURIComponent(customerPhone)}`
    : null;

  return (
    <div
      id={id}
      role="dialog"
      className={[
        "absolute z-30 top-full mt-1 start-0",
        "w-[320px] max-w-[95vw]",
        "rounded-lg border border-line-subtle bg-surface-card",
        "shadow-[0_8px_24px_rgba(0,0,0,0.10)] p-3",
        "text-[13px] text-ink-primary",
      ].join(" ")}
    >
      {isLoading && !detail && (
        <div className="text-ink-muted text-[12px]">{t("loading")}</div>
      )}
      {error && (
        <div className="text-status-critical text-[12px]">{t("error")}</div>
      )}
      {!isLoading && !error && detail && (
        <>
          <div
            className={[
              "font-semibold mb-2",
              repeatKind === "risk" ? "text-status-critical" : "",
            ].join(" ")}
          >
            {headline}
          </div>

          {stats && stats.lifetime_value > 0 && (
            <div className="text-ink-secondary mb-1">
              {t("lifetimeValue", {
                amount: stats.lifetime_value.toFixed(2),
                currency: "",
              })}
            </div>
          )}

          {orders[0] && (
            <div className="text-ink-secondary mb-2">
              {t("lastOrder", {
                date: formatDateTime(orders[0].created_at, locale),
                status: tStatuses(orders[0].status as Parameters<typeof tStatuses>[0]),
              })}
            </div>
          )}

          {orders[0]?.customer_address && (
            <div
              className="text-ink-muted mb-2 text-[12px] truncate"
              title={orders[0].customer_address}
            >
              {t("lastAddress", { address: orders[0].customer_address })}
            </div>
          )}

          {orders.length > 0 && (
            <ul className="border-t border-line-subtle pt-2 mb-2 space-y-1.5 max-h-[180px] overflow-y-auto">
              {orders.slice(0, 6).map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between gap-2 text-[12px]"
                >
                  <span className="font-medium tabular-nums truncate">
                    #{o.external_id ?? o.id.slice(0, 6)}
                  </span>
                  <span className="text-ink-muted shrink-0">
                    {formatDateTime(o.created_at, locale)}
                  </span>
                  <span
                    className={[
                      "rounded-pill px-1.5 py-[1px] text-[11px] font-medium shrink-0",
                      statusToneClass(o.status),
                    ].join(" ")}
                  >
                    {tStatuses(o.status as Parameters<typeof tStatuses>[0])}
                  </span>
                  <span className="tabular-nums shrink-0">
                    {Number(o.total_price).toFixed(0)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {leads.length > 0 && (
            <div className="text-ink-muted text-[12px] mb-2">
              {t("plusLeads", { count: priorLeadCount || leads.length })}
            </div>
          )}

          {seeAllHref && (
            <a
              href={seeAllHref}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-status-action hover:underline text-[12px]"
            >
              {t("seeAll")}
              <ExternalLink size={11} strokeWidth={2} aria-hidden="true" />
            </a>
          )}
        </>
      )}
    </div>
  );
}

function statusToneClass(status: string): string {
  if (status === "delivered") return "bg-status-successBg text-status-success";
  if (status === "rejected") return "bg-status-criticalBg text-status-critical";
  if (status === "returned") return "bg-status-neutralBg text-ink-secondary";
  return "bg-status-neutralBg text-ink-secondary";
}

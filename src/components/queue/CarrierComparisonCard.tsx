"use client";

import { useTranslations } from "next-intl";
import { Scale, Coins, Truck } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { marketIdToCode } from "@/lib/markets";

/**
 * One selectable carrier account in the post-confirm picker, styled after the
 * "Résultat de l'appel" mockup: a radio-style card carrying three stats (fee,
 * 30d delivery rate with a coloured dot, median transit time) and a "meilleur
 * choix" badge on whichever account src/lib/carriers/carrier-comparison.ts
 * picks — not necessarily the cheapest one.
 *
 * Deliberately the one place in the product that uses the green `dispatch-*`
 * family instead of black/white chrome — see globals.css's --dispatch-*
 * block and design-system.md §1 for why this is scoped, not global.
 */

export interface CarrierComparisonCardProps {
  name: string;
  code: string;
  selected: boolean;
  blocked: boolean;
  isBestChoice: boolean;
  cost: number | null;
  deliveryRate: number | null;
  transitHours: number | null;
  marketId: string | null | undefined;
  onSelect: () => void;
}

function deliveryRateTone(rate: number): "good" | "mid" | "low" {
  if (rate >= 0.7) return "good";
  if (rate >= 0.5) return "mid";
  return "low";
}

const RATE_DOT_CLASS: Record<"good" | "mid" | "low", string> = {
  good: "bg-status-success",
  mid: "bg-status-warning",
  low: "bg-status-critical",
};

function Stat({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-2 text-center">
      <div className="flex items-center gap-1 text-[13px] font-semibold text-ink-primary">
        {icon}
        <span className="tabular-nums">{value}</span>
      </div>
      <div className="text-[11px] text-ink-secondary">{label}</div>
    </div>
  );
}

export function CarrierComparisonCard({
  name,
  code,
  selected,
  blocked,
  isBestChoice,
  cost,
  deliveryRate,
  transitHours,
  marketId,
  onSelect,
}: CarrierComparisonCardProps) {
  const t = useTranslations("queue");
  const tCov = useTranslations("dispatch.coverage");
  const market = (marketIdToCode(marketId) ?? "ly").toUpperCase();
  const hasAnyStat = cost != null || deliveryRate != null || transitHours != null;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={blocked}
      aria-disabled={blocked}
      onClick={onSelect}
      className={[
        "w-full rounded-xl border p-3.5 text-start transition-colors duration-fast",
        blocked
          ? "cursor-not-allowed border-status-critical/40 bg-status-criticalBg"
          : selected
            ? "border-dispatch-ok bg-dispatch-ok-tint"
            : "border-line-strong bg-surface-card hover:bg-surface-hover",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            className={[
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
              blocked
                ? "border-status-critical/50"
                : selected
                  ? "border-dispatch-ok bg-dispatch-ok"
                  : "border-line-strong",
            ].join(" ")}
          >
            {selected && !blocked && (
              <span className="h-1.5 w-1.5 rounded-full bg-surface-card" />
            )}
          </span>
          <span className="truncate text-[14px] font-semibold text-ink-primary">
            {name}
          </span>
          {isBestChoice && !blocked && (
            <span className="inline-flex items-center gap-1 rounded-pill bg-dispatch-ok-bg px-2 py-0.5 text-[11px] font-medium text-dispatch-ok-ink">
              <Scale size={11} strokeWidth={2.25} aria-hidden="true" />
              {t("bestChoice")}
            </span>
          )}
        </div>
        {blocked && (
          <span className="shrink-0 text-[11px] font-medium text-status-critical">
            {tCov("badge")}
          </span>
        )}
      </div>

      {isBestChoice && !blocked && (
        <p className="mt-1 text-[12px] text-ink-secondary">{t("bestChoiceHint")}</p>
      )}

      {!blocked && (
        <div className="mt-2.5">
          {hasAnyStat ? (
            <div className="flex items-stretch divide-x divide-line-subtle rounded-md bg-surface-sunken py-2 rtl:divide-x-reverse">
              <Stat
                icon={<Coins size={13} strokeWidth={2} className="text-ink-secondary" aria-hidden="true" />}
                value={cost != null ? formatCurrency(cost, market) : "—"}
                label={t("feeLabel")}
              />
              <Stat
                icon={
                  deliveryRate != null ? (
                    <span
                      aria-hidden="true"
                      className={`h-2 w-2 rounded-full ${RATE_DOT_CLASS[deliveryRateTone(deliveryRate)]}`}
                    />
                  ) : (
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-ink-muted/40" />
                  )
                }
                value={deliveryRate != null ? `${Math.round(deliveryRate * 100)}%` : "—"}
                label={t("deliveryRateLabel")}
              />
              <Stat
                icon={<Truck size={13} strokeWidth={2} className="text-ink-secondary" aria-hidden="true" />}
                value={
                  transitHours != null
                    ? t("transitDays", { count: Math.max(1, Math.round(transitHours / 24)) })
                    : "—"
                }
                label={t("transitTimeLabel")}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-md bg-surface-sunken px-3 py-2">
              <span className="text-[12px] text-ink-secondary">{t("noRateAvailableHint")}</span>
              <span className="rounded-pill bg-status-neutralBg px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
                {t("noRateAvailable")}
              </span>
            </div>
          )}
        </div>
      )}

      <p className="mt-1 text-[11px] text-ink-muted">({code})</p>
    </button>
  );
}

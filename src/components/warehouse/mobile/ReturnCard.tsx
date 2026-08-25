"use client";

import { useTranslations } from "next-intl";
import { Clock, RotateCcw, Send, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { WmCard } from "./primitives";

/**
 * One returned parcel (mockup 04).
 *
 * The desk console keeps the decision in a side panel. On a phone that panel
 * is a screen away from the parcel it describes, so the three decisions live
 * on the card and tapping one both selects the parcel and chooses — the agent
 * already has it in their hand, and "select, then decide" is a step that only
 * existed because the desk had two columns.
 *
 * The three decisions are the system's own: restock (+stock), damage (writes
 * off), redeliver (back out for delivery). Nothing here invents a fourth.
 */

export type Decision = "restock" | "damage" | "redeliver";

const DECISIONS: Array<{ key: Decision; icon: LucideIcon; labelKey: string; tone: string }> = [
  { key: "restock", icon: RotateCcw, labelKey: "restock", tone: "border-wh-ok-edge text-wh-ok" },
  { key: "damage", icon: Trash2, labelKey: "damage", tone: "border-wh-bad-edge text-wh-bad" },
  { key: "redeliver", icon: Send, labelKey: "redeliver", tone: "border-wh-move-edge text-wh-move" },
];

const ON_TONE: Record<Decision, string> = {
  restock: "bg-wh-ok-bg",
  damage: "bg-wh-bad-bg",
  redeliver: "bg-wh-move-bg",
};

/** What is printed on the parcel, in the order a picker would find it. */
function parcelRef(o: WarehouseOrderRow): string {
  return o.carrier_sticker_ref ?? o.tracking_number ?? o.id.slice(0, 8).toUpperCase();
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

export function ReturnCard({
  row,
  picked,
  decision,
  busy,
  currency,
  onPick,
  onDecide,
}: {
  row: WarehouseOrderRow;
  /** Whether THIS parcel is the one the console currently holds. */
  picked: boolean;
  decision: Decision | null;
  busy: boolean;
  currency: string;
  onPick: (row: WarehouseOrderRow) => void;
  onDecide: (decision: Decision) => void;
}) {
  const t = useTranslations("warehouse.returns2");
  // The stepper describes THIS parcel: scanned/taken, decided, recorded.
  const step = picked ? (decision ? 3 : 2) : 1;
  const age = daysSince(row.returned_at ?? row.created_at);

  return (
    <WmCard className="p-3.5">
      <div className="flex items-baseline gap-2">
        <b data-testid="wm-return-ref" className="min-w-0 flex-1 truncate text-[14px] font-extrabold text-wm-accent">
          #{parcelRef(row)}
        </b>
        <span data-testid="wm-return-age" className="shrink-0 text-[11.5px] text-wm-ink-2">
          {t("days", { count: age })}
        </span>
      </div>

      <dl className="mt-2 space-y-0.5 text-[12.5px] text-wm-ink-2">
        <div className="flex gap-1.5">
          <dt className="shrink-0">{t("cardProduct")}</dt>
          <dd className="min-w-0 flex-1 truncate font-semibold text-wm-ink">
            <bdi>{row.product_name}</bdi>
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="shrink-0">{t("cardQty")}</dt>
          <dd data-testid="wm-return-qty" className="font-semibold text-wm-ink">
            {row.quantity}
          </dd>
          <dd className="ms-auto font-semibold tabular-nums text-wm-ink">
            {Number(row.total_price).toFixed(2).replace(".", ",")} {currency}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="shrink-0">{t("cardCustomer")}</dt>
          <dd className="min-w-0 flex-1 truncate">
            <bdi>{row.customer_name}</bdi>
            {row.customer_city ? <> · <bdi>{row.customer_city}</bdi></> : null}
          </dd>
        </div>
      </dl>

      {/* Where this parcel is. Three dots joined by a rule, as in the mockup. */}
      <ol data-testid="wm-step" data-step={String(step)} className="mt-3 flex items-center gap-1.5">
        {[t("step1"), t("step2"), t("step3")].map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-1.5 last:flex-none">
            <span className="flex flex-col items-center gap-1">
              <span
                className={`grid h-5 w-5 place-items-center rounded-pill border-[1.5px] text-[10px] font-bold ${
                  step > i
                    ? "border-wm-accent bg-wm-accent text-white"
                    : "border-wm-track text-wm-ink-2"
                }`}
              >
                {i + 1}
              </span>
              <span
                className={`text-[10px] ${step > i ? "font-semibold text-wm-accent" : "text-wm-ink-2"}`}
              >
                {label}
              </span>
            </span>
            {i < 2 ? (
              <span
                className={`-mt-4 h-px flex-1 ${step > i + 1 ? "bg-wm-accent" : "bg-wm-track"}`}
              />
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {DECISIONS.map((d) => {
          const on = picked && decision === d.key;
          const Icon = d.icon;
          return (
            <button
              key={d.key}
              type="button"
              data-testid={`wm-decide-${d.key}`}
              aria-pressed={on}
              disabled={busy}
              onClick={() => {
                // One tap does both: the agent is holding the parcel, so
                // "select it first" is ceremony inherited from the desk.
                if (!picked) onPick(row);
                onDecide(d.key);
              }}
              className={`inline-flex min-h-[44px] flex-col items-center justify-center gap-0.5 rounded-[10px] border-[1.5px] px-1 text-[11px] font-bold transition-colors disabled:opacity-45 ${d.tone} ${
                on ? ON_TONE[d.key] : "bg-wm-card"
              }`}
            >
              <Icon size={15} aria-hidden="true" />
              <span className="leading-tight">{t(d.labelKey)}</span>
            </button>
          );
        })}
      </div>
    </WmCard>
  );
}

/** The queue footer's average, formatted for humans. */
export function ProcessingTime({
  minutes,
  sample,
}: {
  minutes: number | null;
  sample: number;
}) {
  const t = useTranslations("warehouse.returns2");
  if (minutes === null || sample === 0) return null;

  // 165 828 minutes is a real figure here. Printing it in minutes would be
  // technically true and unreadable.
  const label =
    minutes >= 2880
      ? t("avgDays", { days: Math.round(minutes / 1440) })
      : minutes >= 120
        ? t("avgHours", { hours: Math.round(minutes / 60) })
        : t("avgMinutes", { minutes });

  return (
    <p className="flex items-center justify-center gap-1.5 px-4 py-2.5 text-[11.5px] text-wm-ink-2">
      <Clock size={13} aria-hidden="true" />
      {label}
      {/* An average over three parcels is not a process measurement. */}
      <span className="opacity-70">({t("avgSample", { n: sample })})</span>
    </p>
  );
}

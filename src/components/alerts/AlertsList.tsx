"use client";

import Link from "next/link";
import { Bell, CheckCircle2, ChevronDown } from "lucide-react";
import type { Alert, AlertSeverity } from "@/lib/alerts/types";
import { META_ICONS, SEVERITY_ICONS, SEVERITY_TONE, TYPE_ICONS, TYPE_TONE } from "./constants";
import { formatMeta, typeLabel, type AlertsTranslator } from "./format";

/**
 * One alert.
 *
 * The mark and the age pill take the *type's* hue rather than the severity's.
 * Inside a single band a missed callback and a blocked dispatch are equally
 * urgent and entirely different problems; painting both amber would spend the
 * row's only colour on something the band header already said.
 */
export function AlertRow({
  alert,
  selected,
  onToggle,
  locale,
  t,
  onNavigate,
}: {
  alert: Alert;
  selected: boolean;
  onToggle: () => void;
  locale: string;
  t: AlertsTranslator;
  /** Called when the user follows the alert's link (e.g. to close a hosting panel). */
  onNavigate?: () => void;
}) {
  const tone = TYPE_TONE[alert.type] ?? SEVERITY_TONE[alert.severity];
  const Icon = TYPE_ICONS[alert.type] ?? Bell;
  const MetaIcon = META_ICONS[alert.type];
  const label = typeLabel(alert.type, t);

  return (
    <li>
      <div
        className={[
          "flex items-center gap-3 rounded-[12px] border px-3 py-2.5 transition-colors duration-fast",
          selected
            ? "border-oms-border-strong bg-oms-sunken"
            : "border-transparent bg-oms-surface hover:bg-oms-sunken",
        ].join(" ")}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={t("selectAlert", { title: alert.primary || label })}
          className="h-4 w-4 flex-shrink-0 cursor-pointer rounded-[4px]"
        />

        <span
          aria-hidden="true"
          className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-[12px] ${tone.soft}`}
        >
          <Icon size={19} strokeWidth={1.9} />
        </span>

        <Link
          href={`/${locale}${alert.href}`}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 flex-col gap-0.5 no-underline"
        >
          <span className="truncate text-[13.5px] font-semibold text-oms-ink-1">
            {alert.primary || label}
          </span>
          <span className="truncate text-[12px] text-oms-ink-3">
            {label}
            {alert.secondary ? ` · ${alert.secondary}` : null}
          </span>
        </Link>

        <span
          className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-[5px] text-[11.5px] font-semibold tabular-nums ${tone.badge}`}
        >
          {MetaIcon && <MetaIcon size={12} strokeWidth={2.25} aria-hidden="true" />}
          {formatMeta(alert, t)}
        </span>
      </div>
    </li>
  );
}

/**
 * A severity band, as its own card.
 *
 * The flat list gave the eye nothing to land on: nineteen rows where a callback
 * 1 h 35 late and a dispatch blocked seven weeks carried identical weight. The
 * band is the hierarchy the tiles always implied but the list never showed, and
 * it collapses so a long tail can be folded away without being filtered out and
 * forgotten.
 */
export function AlertBand({
  severity,
  label,
  count,
  collapsed,
  onToggleCollapsed,
  t,
  children,
}: {
  severity: AlertSeverity;
  label: string;
  count: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  t: AlertsTranslator;
  children: React.ReactNode;
}) {
  const tone = SEVERITY_TONE[severity];
  const Icon = SEVERITY_ICONS[severity];

  return (
    <section
      data-testid={`alert-band-${severity}`}
      data-severity={severity}
      className="overflow-hidden rounded-[16px] border border-oms-border bg-oms-surface"
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t("groupExpand") : t("groupCollapse")}
        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-start transition-colors duration-fast hover:bg-oms-sunken"
      >
        <span
          aria-hidden="true"
          className={`grid h-6 w-6 flex-shrink-0 place-items-center rounded-full ${tone.solid}`}
        >
          <Icon size={14} strokeWidth={2.5} />
        </span>
        <span className="text-[12px] font-bold uppercase tracking-[0.05em] text-oms-ink-1">
          {label}
        </span>
        <span
          data-testid="alert-band-count"
          className="grid h-[20px] min-w-[20px] place-items-center rounded-pill bg-oms-sunken px-1.5 text-[11px] font-bold tabular-nums text-oms-ink-2"
        >
          {count}
        </span>
        <span className="flex-1" />
        <ChevronDown
          size={17}
          strokeWidth={2}
          aria-hidden="true"
          className={`text-oms-ink-3 transition-transform duration-fast ${collapsed ? "-rotate-90 rtl:rotate-90" : ""}`}
        />
      </button>

      {!collapsed && (
        <ul className="m-0 flex list-none flex-col gap-1 border-t border-oms-border p-1.5">
          {children}
        </ul>
      )}
    </section>
  );
}

export function AllClear({
  t,
  total,
  hasFilter,
}: {
  t: AlertsTranslator;
  total: number;
  hasFilter: boolean;
}) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-2.5 rounded-[16px] border border-oms-border bg-oms-surface px-6 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-full bg-hue-green-bg">
        <CheckCircle2 size={24} strokeWidth={2} aria-hidden="true" className="text-hue-green-ink" />
      </span>
      <div className="text-[14.5px] font-semibold text-oms-ink-1">
        {total === 0 ? t("allClearTitle") : t("noneMatchFilter")}
      </div>
      <div className="max-w-[280px] text-[12px] leading-[1.5] text-oms-ink-3">
        {total === 0 || !hasFilter ? t("allClearSubtitle") : t("adjustFilters")}
      </div>
    </div>
  );
}

"use client";

import { Fragment, useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ChevronsUpDown, Package } from "lucide-react";
import { DARB_ZONE_ORDER, zoneLabels } from "@/lib/carriers/darb-zones";
import { deskAge, firstName, type FoldSummary } from "@/lib/warehouse/desk-sortir";
import { useDeskScan } from "@/components/warehouse/desk/DeskScanContext";
import type { PrepRow } from "./PrepCard";

/**
 * Desk Sortir — « À scanner ».
 *
 * One table card grouped by Darb sticker roll, which is the order parcels get
 * stickered in. The colours are the carrier's own (its branch directory), so
 * the swatch matches the physical roll on the shelf.
 *
 * « Prendre » puts a parcel in hand; the top bar's scan field then asks for
 * that roll's sticker and binds it. There is no scanner, search box or KPI on
 * this screen any more: the building switch in the top bar is the filter, and
 * the field in the top bar is the scanner.
 */

/** Carrier states that mean the parcel has already left. It cannot be scanned. */
const GONE_AT_CARRIER = new Set(["released", "completed", "returning", "returned"]);

/** Age on the BENCH, not since intake — the two clocks differ by up to a month. */
function benchHours(row: PrepRow): number {
  const since = row.uploaded_at ?? row.created_at;
  return Math.max(0, (Date.now() - new Date(since).getTime()) / 3_600_000);
}

const TD = "border-b border-[#ECEEF0] px-[14px] py-[12px] align-middle";
const TH =
  "whitespace-nowrap border-b border-[#ECEEF0] bg-white px-[14px] py-[11px] text-start text-[11px] font-semibold uppercase leading-[1.5] tracking-[0.05em] text-[#6D7175] rtl:text-[12px] rtl:normal-case rtl:tracking-normal";

export function PreparationConsole({
  market,
  orders,
  siteNames,
  fold,
  warehouseId,
}: {
  market: "ly" | "tn";
  orders: PrepRow[];
  /** Building names by id, in the market's language. */
  siteNames: Record<string, string>;
  fold: FoldSummary;
  /** The building chosen in the top bar; null = every building. */
  warehouseId: string | null;
}) {
  const t = useTranslations("warehouse.desk");
  const tAge = useTranslations("warehouse.age");
  const locale = useLocale();
  const isLy = market === "ly";
  const { hand, take } = useDeskScan();

  const groups = useMemo(() => {
    const by = new Map<string, PrepRow[]>();
    for (const o of orders) {
      const key = o.zone?.colorHex ?? "unknown";
      if (!by.has(key)) by.set(key, []);
      by.get(key)!.push(o);
    }
    const ordered = [...DARB_ZONE_ORDER, ...[...by.keys()].filter((k) => k !== "unknown" && !DARB_ZONE_ORDER.includes(k)), "unknown"];
    return ordered.filter((k) => by.has(k)).map((key) => ({ key, rows: by.get(key)! }));
  }, [orders]);

  const ageText = (row: PrepRow) => {
    const a = deskAge(benchHours(row));
    const label = a.unit === "now" ? t("now") : tAge(a.unit, { n: a.n });
    return { ...a, label };
  };

  return (
    <div className="overflow-hidden rounded-[14px] border border-[#ECEEF0] bg-white">
      <table className="w-full border-collapse text-[14px] leading-[1.5] text-[#1A1A1A]">
        <thead>
          <tr>
            <th className={`${TH} min-w-[260px]`}>{t("colParcel")}</th>
            <th className={TH}>{t("colDest")}</th>
            <th className={TH}>{t("colClient")}</th>
            <th className={TH}>{t("colAge")}</th>
            <th className={TH}>{t("colSite")}</th>
            <th className={`${TH} text-end`} />
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-[14px] py-[40px] text-center text-[13px] text-[#6D7175]">
                {t("empty")}
              </td>
            </tr>
          ) : (
            groups.map((g) => (
              <Fragment key={g.key}>
                {isLy ? (
                  <RollRow
                    hex={g.key === "unknown" ? null : g.key}
                    count={g.rows.length}
                    locale={locale}
                    warehouseId={warehouseId}
                    t={t}
                  />
                ) : null}
                {g.rows.map((o) => {
                  const inHand = hand?.id === o.id;
                  const gone = GONE_AT_CARRIER.has(o.carrier_status_slug ?? "");
                  const age = ageText(o);
                  return (
                    <tr
                      key={o.id}
                      data-testid="wh-desk-parcel"
                      data-hand={inHand ? "true" : "false"}
                      className={
                        inHand
                          ? "[&>td]:bg-[var(--brand-tint)] [&:last-child>td]:border-b-0"
                          : "[&:hover>td]:bg-[#F7F7F7] [&:last-child>td]:border-b-0"
                      }
                    >
                      <td
                        className={`${TD} ${
                          inHand ? "shadow-[inset_3px_0_0_var(--brand)] rtl:shadow-[inset_-3px_0_0_var(--brand)]" : ""
                        }`}
                      >
                        <div className="flex items-center gap-[12px]">
                          <span
                            aria-hidden="true"
                            className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-job-bg text-job-ink"
                          >
                            <Package size={16} />
                          </span>
                          <span className="min-w-0 font-semibold">
                            <bdi>{o.product_name}</bdi>
                            {o.variant_label ? <bdi>{` · ${o.variant_label}`}</bdi> : null}
                          </span>
                          <span dir="ltr" className="tabular-nums text-[#6D7175]">×{o.quantity}</span>
                        </div>
                      </td>
                      <td className={TD}>
                        <bdi>{o.customer_city ?? "—"}</bdi>
                      </td>
                      <td className={`${TD} text-[#6D7175]`}>
                        <bdi>{firstName(o.customer_name)}</bdi>
                      </td>
                      <td className={TD}>
                        {age.late ? (
                          <span
                            data-testid="wh-desk-age"
                            data-late="true"
                            className="inline-flex items-center gap-[6px] whitespace-nowrap rounded-full bg-[#FFF8E6] px-[9px] py-[2px] text-[12px] font-semibold text-[#7A5B00]"
                          >
                            <i aria-hidden="true" className="h-[6px] w-[6px] shrink-0 rounded-full bg-[#B98900]" />
                            {age.label}
                          </span>
                        ) : (
                          <span data-testid="wh-desk-age" data-late="false" className="whitespace-nowrap text-[#6D7175]">
                            {age.label}
                          </span>
                        )}
                      </td>
                      <td className={`${TD} text-[#6D7175]`}>
                        <bdi>{(o.warehouse_id && siteNames[o.warehouse_id]) || "—"}</bdi>
                      </td>
                      <td className={`${TD} text-end`}>
                        {inHand ? (
                          <span className="inline-flex items-center gap-[6px] whitespace-nowrap rounded-full bg-[#F1F8F5] px-[9px] py-[2px] text-[12px] font-semibold text-[#008060]">
                            <i aria-hidden="true" className="h-[6px] w-[6px] shrink-0 rounded-full bg-[#008060]" />
                            {t("inHand")}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => take(o)}
                            disabled={gone}
                            title={gone ? t("gone") : undefined}
                            className="inline-flex h-[30px] items-center justify-center whitespace-nowrap rounded-[8px] border border-[#C9CCCF] bg-white px-[10px] text-[12.5px] font-semibold text-[#1A1A1A] hover:bg-[#F7F7F7] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {t("take")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))
          )}
        </tbody>
      </table>

      {fold.total > 0 ? (
        /* Taken off the bench after sitting there too long — never cancelled,
           never deleted, still `uploaded`. Not listed: get_to_label_orders
           only returns parcels on the bench. */
        <div
          data-testid="wh-desk-fold"
          className="flex w-full items-center gap-[12px] border-t border-[#ECEEF0] px-[18px] py-[14px] text-[#6D7175]"
        >
          <ChevronsUpDown size={16} aria-hidden="true" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-[#1A1A1A]">
              {t("older")} · <span className="tabular-nums">{fold.total}</span>
            </div>
            <div className="text-[12.5px]">
              {[
                ...fold.parts.map((p) =>
                  p.dead.length
                    ? t("olderSiteDead", {
                        site: p.site,
                        n: p.n,
                        dead: p.dead.map((d) => `${d.n} ${d.carrier}`).join(", "),
                      })
                    : t("olderSite", { site: p.site, n: p.n }),
                ),
                t("olderTail"),
              ].join(" · ")}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The band that opens each roll: Darb's own swatch, the colour named on the
 * surface beside it (Darb's palette cannot carry text), the zone, the count,
 * and the run on that roll.
 */
function RollRow({
  hex,
  count,
  locale,
  warehouseId,
  t,
}: {
  hex: string | null;
  count: number;
  locale: string;
  warehouseId: string | null;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const labels = zoneLabels(hex, locale);
  const known = hex !== null && labels.colour !== null;
  const href = known
    ? `/${locale}/warehouse/scan?roll=${encodeURIComponent(hex)}${
        warehouseId ? `&warehouse_id=${encodeURIComponent(warehouseId)}` : ""
      }`
    : null;
  return (
    <tr data-testid="wh-desk-rollrow" data-roll={hex ?? ""}>
      <td colSpan={6} className="border-b border-[#ECEEF0] bg-[#FAFAFB] px-[14px] py-[10px]">
        <div className="flex items-center gap-[12px]">
          {known ? (
            <span
              data-testid="wh-desk-swatch"
              aria-hidden="true"
              className="inline-block h-[28px] w-[12px] shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.08)]"
              style={{ background: hex }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-block h-[28px] w-[12px] shrink-0 rounded-[4px] border border-dashed border-[#C9CCCF]"
            />
          )}
          <b className="font-bold">{known ? t("roll", { colour: labels.colour! }) : t("rollUnknown")}</b>
          {labels.name ? <span className="text-[12.5px] text-[#6D7175]">{labels.name}</span> : null}
          <span className="flex-1" />
          <b data-testid="wh-desk-rollcount" className="font-bold tabular-nums">{count}</b>
          {href ? (
            <Link
              href={href}
              className="inline-flex h-[30px] items-center justify-center whitespace-nowrap rounded-[8px] bg-job px-[10px] text-[12.5px] font-semibold text-white hover:opacity-90"
            >
              {t("startRun")}
            </Link>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

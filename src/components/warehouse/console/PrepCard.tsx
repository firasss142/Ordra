"use client";

import { useLocale, useTranslations } from "next-intl";
import { Boxes, HelpCircle } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";
import { zoneLabels } from "@/lib/carriers/darb-zones";
import { WhPill } from "./primitives";
import { WH_LABEL } from "./tokens";

/**
 * One parcel on the bench, as the phone shows it.
 *
 * The desk table put six columns into 390px: PRODUIT and COMMANDE overprinted
 * each other and rendered as "PRODUMANDE", and every customer name truncated
 * to a single letter. The card carries the same six facts in reading order —
 * who and where, what, how much to collect, how long it has waited — plus the
 * one fact the desk table could afford to bury and the phone cannot: which
 * coloured Darb roll the agent must pick up before touching the parcel.
 *
 * HIERARCHY. The bench loop is: read the colour → fetch that sticker → find
 * this parcel → take → scan. The colour is the first physical act and the only
 * irreversible one — a wrong roll puts the parcel on the wrong truck and Darb
 * accepts it silently — so it leads the card at instruction scale. Everything
 * the agent does NOT act on here recedes: the collect amount is the courier's
 * business, not the packer's, and it was previously the boldest thing on the
 * card after the name.
 *
 * The name never sits ON the colour. Darb's palette was chosen for printed
 * stickers, and it cannot carry text: measured against the nine published
 * hues, #339307 (vert) reaches only 4.30:1 with our ink and 3.95:1 with white,
 * so NO ink clears AA on it. The swatch carries the hue, the card surface
 * carries the word, and the branch code rides a solid white plate (16.97:1 on
 * every colour) rather than a tint that would range from 1.1:1 to 12.9:1.
 */

export type PrepRow = WarehouseOrderRow & { zone: OrderZone };

/** Carrier states that mean the parcel has already left. It cannot be scanned. */
const GONE_AT_CARRIER = new Set(["released", "completed", "returning", "returned"]);

type AgeTone = "ok" | "warn" | "bad";

/** A `warehouse.age` translator: `hours` / `days`, each taking `{n}`. */
export type AgeTranslate = (key: "hours" | "days", values: { n: number }) => string;

/**
 * "3 h" / "3 j" in the operator's language. Hours until a full day, then
 * whole days: nobody reads "95 h" as four days.
 */
export function benchAgeLabel(hours: number, t: AgeTranslate): string {
  return hours < 24
    ? t("hours", { n: Math.round(hours) })
    : t("days", { n: Math.floor(hours / 24) });
}

/**
 * Age on the BENCH, not since intake. An order created three weeks ago and
 * uploaded this morning has been the warehouse's problem for two hours.
 */
function ageOf(row: PrepRow): { hours: number; tone: AgeTone } {
  const since = row.uploaded_at ?? row.created_at;
  const hours = Math.max(0, (Date.now() - new Date(since).getTime()) / 3_600_000);
  return { hours, tone: hours >= 48 ? "bad" : hours >= 12 ? "warn" : "ok" };
}

const AGE_CLASS: Record<AgeTone, string> = {
  bad: "bg-wh-bad-bg text-wh-bad",
  warn: "bg-wh-warn-bg text-wh-warn",
  ok: "bg-wh-sunken text-wh-ink-2",
};

export function PrepCard({
  row,
  isLy,
  hand,
  onTake,
  currency,
}: {
  row: PrepRow;
  isLy: boolean;
  hand: PrepRow | null;
  onTake: (row: PrepRow) => void;
  currency: string;
}) {
  const t = useTranslations("warehouse.prep2");
  const tAge = useTranslations("warehouse.age");
  const locale = useLocale();
  const age = ageOf(row);
  const ageLabel = benchAgeLabel(age.hours, tAge);
  // The roll colour in the agent's own language: "Vert" on an Arabic phone
  // is a word to translate before walking to the shelf.
  const zone = zoneLabels(row.zone.colorHex, locale);
  const inHand = hand?.id === row.id;
  const gone = GONE_AT_CARRIER.has(row.carrier_status_slug ?? "");
  // Without Darb's internal id the sticker cannot be bound at all. Say so here
  // rather than letting the agent find out at the scanner, parcel in hand.
  const unbindable = isLy && !gone && row.has_carrier_ref === false;
  const stock = row.current_stock ?? 0;
  const lowStock = stock <= (row.low_stock_threshold ?? 0);

  return (
    <article
      data-testid="wh-prep-card"
      data-in-hand={inHand ? "true" : "false"}
      className={`rounded-wh border bg-wh-surface ${
        inHand ? "border-wh-ok shadow-[inset_3px_0_0_var(--wh-ok)]" : "border-wh-border"
      }`}
    >
      {isLy ? (
        // The roll instruction leads the card: fetch this colour of sticker,
        // then fetch the parcel. Sized to be read standing, at arm's length.
        <div
          data-testid="wh-prep-roll"
          className="flex items-center gap-3 rounded-t-wh border-b border-wh-border bg-wh-sunken px-3 py-2.5"
        >
          <span
            data-testid="wh-prep-swatch"
            aria-hidden="true"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] border border-black/15"
            style={{ background: row.zone.colorHex ?? "var(--wh-surface)" }}
          >
            {/* The branch code sits on a SOLID white plate, not on the hue.
                Over nine colours an alpha fill ranges from 1.1:1 to 12.9:1 and
                washed out on rouge and brun; opaque white is 16.97:1 on all. */}
            {row.zone.colorHex && row.zone.branchGroup ? (
              <span className="rounded-[6px] bg-white px-1.5 py-0.5 font-mono text-[10.5px] font-bold tracking-[0.02em] text-wh-ink-1">
                {row.zone.branchGroup}
              </span>
            ) : (
              <HelpCircle size={18} className="text-wh-ink-3" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block ${WH_LABEL}`}>{t("rollLabel")}</span>
            {/* On the surface, never on the hue — see the header comment. */}
            <b
              data-testid="wh-prep-roll-name"
              className="block truncate text-[15px] font-bold leading-tight text-wh-ink-1"
            >
              {zone.colour ?? t("zoneUnknown")}
            </b>
            {zone.name ? (
              <span className="block truncate text-[11.5px] text-wh-ink-3">{zone.name}</span>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="p-3.5">
        <div className="flex items-start gap-2.5">
          <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[8px] border border-wh-border bg-wh-sunken">
            <Boxes size={15} className="text-wh-ink-3" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[14px] font-semibold text-wh-ink-1">
              <bdi>{row.customer_name}</bdi>
            </b>
            <span className="block truncate font-mono text-[11.5px] tabular-nums text-wh-ink-3">
              {row.carrier_sticker_ref ?? row.id.slice(0, 8).toUpperCase()}
              {row.customer_city ? (
                <>
                  {" · "}
                  <bdi>{row.customer_city}</bdi>
                </>
              ) : null}
            </span>
          </div>
          <span
            data-testid="wh-prep-age"
            title={t("ageFromUpload")}
            className={`shrink-0 whitespace-nowrap rounded-pill px-2.5 py-1 font-mono text-[11.5px] font-semibold tabular-nums ${AGE_CLASS[age.tone]}`}
          >
            {ageLabel}
          </span>
        </div>

        {gone || unbindable ? (
          <div className="mt-2">
            {gone ? (
              <WhPill tone="bad">{t("goneAtCarrier")}</WhPill>
            ) : (
              <WhPill tone="warn">{t("noCarrierRef")}</WhPill>
            )}
          </div>
        ) : null}

        <p className="mt-2.5 truncate text-[12.5px] text-wh-ink-2">
          <bdi>{row.product_name}</bdi>
          {row.variant_label ? ` · ${row.variant_label}` : ""}{" "}
          <span className="text-wh-ink-3">× {row.quantity}</span>
        </p>

        <div className="mt-2.5 flex items-center gap-3 border-t border-wh-border pt-2.5">
          {/* The courier collects this, not the packer. It is context, so it
              is set at the same weight as the stock figure beside it. */}
          <span
            data-testid="wh-prep-amount"
            className="font-mono text-[13px] tabular-nums text-wh-ink-2"
          >
            {Number(row.total_price).toFixed(2).replace(".", ",")}
            <span className="ms-1 font-sans text-[11px] text-wh-ink-3">{currency}</span>
          </span>
          <span className="font-mono text-[11.5px] tabular-nums text-wh-ink-3">
            {t("colStock")} {stock}
            <span
              className={`ms-1 inline-block h-[7px] w-[7px] rounded-pill ${
                lowStock ? "bg-wh-bad" : "bg-wh-ok"
              }`}
              aria-hidden="true"
            />
          </span>
          <button
            type="button"
            onClick={() => onTake(row)}
            disabled={gone}
            className={`ms-auto inline-flex min-h-[44px] shrink-0 items-center rounded-pill border px-4 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${
              inHand
                ? "border-wh-ok bg-wh-ok text-white"
                : "border-wh-border bg-wh-surface text-wh-ink-1 active:bg-wh-sunken"
            }`}
          >
            {t("take")}
          </button>
        </div>
      </div>
    </article>
  );
}

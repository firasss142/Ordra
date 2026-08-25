"use client";

import { useTranslations } from "next-intl";
import { Boxes } from "lucide-react";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import type { OrderZone } from "@/lib/warehouse/zone-index";
import { WhPill } from "./primitives";

/**
 * One parcel on the bench, as the phone shows it.
 *
 * The desk table put six columns into 390px: PRODUIT and COMMANDE overprinted
 * each other and rendered as "PRODUMANDE", and every customer name truncated
 * to a single letter. The card carries the same six facts in reading order —
 * who and where, what, how much to collect, how long it has waited — plus the
 * one fact the desk table could afford to bury and the phone cannot: which
 * coloured Darb roll the agent must pick up before touching the parcel.
 */

export type PrepRow = WarehouseOrderRow & { zone: OrderZone };

/** Carrier states that mean the parcel has already left. It cannot be scanned. */
const GONE_AT_CARRIER = new Set(["released", "completed", "returning", "returned"]);

type AgeTone = "ok" | "warn" | "bad";

/**
 * Age on the BENCH, not since intake. An order created three weeks ago and
 * uploaded this morning has been the warehouse's problem for two hours.
 */
function ageOf(row: PrepRow): { label: string; tone: AgeTone } {
  const since = row.uploaded_at ?? row.created_at;
  const hours = Math.max(0, (Date.now() - new Date(since).getTime()) / 3_600_000);
  return {
    label: hours < 24 ? `${Math.round(hours)} h` : `${Math.floor(hours / 24)} j`,
    tone: hours >= 48 ? "bad" : hours >= 12 ? "warn" : "ok",
  };
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
  const age = ageOf(row);
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
        // The roll strip leads the card because it is the first physical act:
        // fetch this colour of sticker, then fetch the parcel.
        <div
          data-testid="wh-prep-roll"
          className="flex items-center gap-2 rounded-t-wh border-b border-wh-border bg-wh-sunken px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-wh-ink-2"
        >
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-pill border border-black/15"
            style={{ background: row.zone.colorHex ?? "transparent" }}
            aria-hidden="true"
          />
          {/* Never the swatch alone: two of the nine Darb colours sit about
              ΔE 10 apart, so the name is the instruction. */}
          <span className="truncate">
            {row.zone.colourFr ?? t("zoneUnknown")}
            {row.zone.nameFr ? (
              <span className="ms-1.5 font-semibold normal-case text-wh-ink-3">
                — {row.zone.nameFr}
              </span>
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
            {age.label}
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
          <span className="font-mono text-[15px] font-semibold tabular-nums text-wh-ink-1">
            {Number(row.total_price).toFixed(2).replace(".", ",")}
            <span className="ms-1 font-sans text-[11px] font-semibold text-wh-ink-3">
              {currency}
            </span>
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

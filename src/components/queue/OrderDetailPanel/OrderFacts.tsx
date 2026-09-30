"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { CarrierMark } from "@/components/shared/CarrierMark";

/**
 * The facts a manager checks before doing anything else, as an aligned grid:
 * label above, value below, columns lining up.
 *
 * It replaces a run of middot-separated inline text where you had to hunt for
 * where one value ended and the next began. Money is stated exactly as the
 * table's Total column states it — two decimals, tabular figures, currency
 * demoted — so one order never reads as two different amounts in two places.
 *
 * Destination leads. The city and the address used to be a tab away, which
 * meant the one field that can block the shipment was invisible from the
 * surface where the shipment is authorised; a missing city now reads as a
 * blocker in place, not as an empty cell.
 */

interface Props {
  total: number;
  currencyCode: string;
  itemCount: number;
  /** Delivery city. `null` / blank renders the missing-city treatment. */
  city?: string | null;
  /** Street address — free text, any script. */
  address?: string | null;
  /**
   * `null` means genuinely unassigned; `undefined` means the name has not been
   * resolved yet, and the cell is omitted rather than claiming "Non assigné"
   * about an order that does have an owner.
   */
  agentName?: string | null;
  carrierName?: string | null;
  /**
   * Opens the city picker. Omitted where the reader cannot edit the order —
   * the blocker is still reported, just without a door out of it.
   */
  onResolveCity?: () => void;
}

export function OrderFacts({
  total,
  currencyCode,
  itemCount,
  city,
  address,
  agentName,
  carrierName,
  onResolveCity,
}: Props) {
  const t = useTranslations("orders.detail");

  const cityMissing = !city?.trim();

  return (
    <dl className="m-0 grid grid-cols-2 gap-px border-y border-oms-border bg-oms-border">
      {city !== undefined && (
        <Fact label={t("factCity")}>
          {cityMissing ? (
            <span
              data-testid="fact-city-missing"
              className="mt-0.5 flex w-full flex-col items-start gap-2 rounded-[8px] border border-oms-warn bg-oms-warn-bg px-[11px] py-[9px]"
            >
              <span className="inline-flex items-center gap-[7px] text-[14px] font-bold text-oms-warn-ink">
                <AlertTriangle size={16} strokeWidth={2.2} aria-hidden="true" />
                {t("factCityMissing")}
              </span>
              {onResolveCity ? (
                <button
                  type="button"
                  onClick={onResolveCity}
                  className="h-[30px] whitespace-nowrap rounded-[7px] border border-oms-warn/50 bg-oms-surface px-3 text-[13px] font-semibold text-oms-warn-ink transition-colors duration-fast hover:bg-oms-warn/10"
                >
                  {t("factCityResolve")}
                </button>
              ) : null}
            </span>
          ) : (
            <span className="truncate">{city}</span>
          )}
        </Fact>
      )}

      {address !== undefined && (
        <Fact label={t("factAddress")}>
          {/* dir="auto" so an Arabic address resolves its own direction inside
              otherwise-LTR chrome, and vice versa in the Libyan console. */}
          <span
            data-testid="fact-address"
            dir="auto"
            className={`min-w-0 text-[13px] leading-[1.5] ${address ? "font-medium" : "font-normal text-oms-ink-3"}`}
          >
            {address || "—"}
          </span>
        </Fact>
      )}

      <Fact label={t("factTotal")}>
        <span className="text-[17px] font-bold tracking-[-0.02em] tabular-nums text-oms-ink-1">
          {(Number(total) || 0).toFixed(2)}
          <span className="ms-1 text-[10.5px] font-medium uppercase tracking-[0.05em] text-oms-ink-3">
            {currencyCode}
          </span>
        </span>
      </Fact>

      <Fact label={t("factItems")}>
        <span className="text-[15px] font-bold tabular-nums">{itemCount}</span>
      </Fact>

      {agentName !== undefined && (
        <Fact label={t("factAgent")}>
          <AgentAvatar name={agentName} size={26} />
          <span className={`truncate ${agentName ? "" : "font-normal italic text-oms-ink-3"}`}>
            {agentName ?? t("unassigned")}
          </span>
        </Fact>
      )}

      {carrierName !== undefined && (
        <Fact label={t("factCarrier")}>
          {carrierName ? (
            <span className="inline-flex h-[26px] min-w-0 items-center gap-[7px] rounded-[6px] bg-oms-sunken px-[9px] text-[12.5px] font-semibold text-oms-ink-2">
              <CarrierMark name={carrierName} size={16} />
              <span className="truncate">{carrierName}</span>
            </span>
          ) : (
            <span className="font-normal text-oms-ink-3">—</span>
          )}
        </Fact>
      )}
    </dl>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-card px-[18px] pb-3 pt-2.5 max-lg:px-3.5">
      <dt className="text-[12.5px] text-oms-ink-3">{label}</dt>
      <dd className="m-0 mt-[3px] flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-oms-ink-1">
        {children}
      </dd>
    </div>
  );
}

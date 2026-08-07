"use client";

import { useTranslations } from "next-intl";
import { AgentAvatar } from "@/components/shared/AgentAvatar";
import { CarrierMark } from "@/components/shared/CarrierMark";

/**
 * The four facts a manager checks before doing anything else, as an aligned
 * grid: label above, value below, columns lining up.
 *
 * It replaces a run of middot-separated inline text where you had to hunt for
 * where one value ended and the next began. Money is stated exactly as the
 * table's Total column states it — two decimals, tabular figures, currency
 * demoted — so one order never reads as two different amounts in two places.
 */

interface Props {
  total: number;
  currencyCode: string;
  itemCount: number;
  /**
   * `null` means genuinely unassigned; `undefined` means the name has not been
   * resolved yet, and the cell is omitted rather than claiming "Non assigné"
   * about an order that does have an owner.
   */
  agentName?: string | null;
  carrierName?: string | null;
}

export function OrderFacts({ total, currencyCode, itemCount, agentName, carrierName }: Props) {
  const t = useTranslations("orders.detail");

  return (
    <dl className="m-0 grid grid-cols-2 gap-px border-y border-oms-border bg-oms-border">
      <Fact label={t("factTotal")}>
        <span className="text-[16px] font-[650] tracking-[-0.02em] tabular-nums text-oms-ink-1">
          {(Number(total) || 0).toFixed(2)}
          <span className="ms-1 text-[10.5px] font-medium uppercase tracking-[0.05em] text-oms-ink-3">
            {currencyCode}
          </span>
        </span>
      </Fact>

      <Fact label={t("factItems")}>
        <span className="tabular-nums">{itemCount}</span>
      </Fact>

      {agentName !== undefined && (
        <Fact label={t("factAgent")}>
          <AgentAvatar name={agentName} size={21} />
          <span className={`truncate ${agentName ? "" : "font-normal italic text-oms-ink-3"}`}>
            {agentName ?? t("unassigned")}
          </span>
        </Fact>
      )}

      {carrierName !== undefined && (
        <Fact label={t("factCarrier")}>
          {carrierName ? (
            <>
              <CarrierMark name={carrierName} size={21} />
              <span className="truncate">{carrierName}</span>
            </>
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
    <div className="bg-surface-card px-[18px] py-[11px]">
      <dt className="mb-1 text-[10.5px] font-[650] uppercase tracking-[0.085em] text-oms-ink-3">
        {label}
      </dt>
      <dd className="m-0 flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-oms-ink-1">
        {children}
      </dd>
    </div>
  );
}

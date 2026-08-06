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
    <dl className="m-0 grid grid-cols-2 gap-px border-y border-line-subtle bg-line-subtle">
      <Fact label={t("factTotal")}>
        <span className="text-[16px] font-[650] tracking-[-0.02em] tabular-nums text-ink-primary">
          {total.toFixed(2)}
          <span className="ms-1 text-[10.5px] font-medium uppercase tracking-[0.05em] text-ink-muted">
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
          <span className={`truncate ${agentName ? "" : "font-normal italic text-ink-muted"}`}>
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
            <span className="font-normal text-ink-muted">—</span>
          )}
        </Fact>
      )}
    </dl>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-card px-4 py-2.5">
      <dt className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.085em] text-ink-muted">
        {label}
      </dt>
      <dd className="m-0 flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-ink-primary">
        {children}
      </dd>
    </div>
  );
}

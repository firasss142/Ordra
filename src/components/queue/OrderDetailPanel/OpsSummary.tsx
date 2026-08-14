"use client";

import { useTranslations } from "next-intl";
import { BarChart3 } from "lucide-react";
import { marketIdToCode } from "@/lib/markets";
import { formatDateTime } from "@/lib/format";

interface Props {
  marketId: string;
  currencyCode: string;
  createdAt: string;
  /** Storefront order number. Null means the order was keyed in by hand. */
  externalId: string | null;
  duplicateCount: number;
  attemptsCount: number;
  /** The market's ceiling. Null until settings load — show the bare count. */
  maxAttempts: number | null;
  locale: string;
}

/**
 * What a manager needs to know about an order that an agent does not: where it
 * came from, when, and whether it is one of several.
 *
 * Deliberately no money beyond the total the facts grid already states. A
 * per-order margin needs a cost model that does not exist yet — the
 * calculations in lib/calculations are market-level and want COGS, carrier
 * fees and ad spend — and a margin figure invented in a UI pass would be read
 * as authoritative the moment it appeared.
 */
export function OpsSummary({
  marketId,
  currencyCode,
  createdAt,
  externalId,
  duplicateCount,
  attemptsCount,
  maxAttempts,
  locale,
}: Props) {
  const t = useTranslations("orders.detail");
  const code = marketIdToCode(marketId);

  return (
    <section
      aria-label={t("ops.title")}
      className="mx-[18px] mt-3.5 rounded-[12px] bg-oms-accent-bg px-[15px] py-[13px]"
    >
      <h3 className="mb-2.5 flex items-center gap-2 text-[13px] font-[650] text-oms-accent-ink">
        <BarChart3 size={15} strokeWidth={2} aria-hidden="true" />
        {t("ops.title")}
      </h3>

      <dl className="m-0 grid grid-cols-2 gap-x-3.5 gap-y-2.5">
        <Cell label={t("ops.market")} testId="ops-market">
          {code ? t(`ops.market_${code}` as Parameters<typeof t>[0]) : "—"}
          <span className="ms-1 text-[10.5px] font-medium uppercase text-oms-ink-3">
            {currencyCode}
          </span>
        </Cell>

        <Cell label={t("ops.origin")} testId="ops-origin">
          {externalId ? (
            <>
              {t("ops.originStorefront")}
              <span className="ms-1 text-[11.5px] font-medium text-oms-ink-3">{externalId}</span>
            </>
          ) : (
            t("ops.originManual")
          )}
        </Cell>

        <Cell label={t("ops.createdAt")} testId="ops-created">
          {formatDateTime(createdAt, locale)}
        </Cell>

        <Cell label={t("ops.duplicates")} testId="ops-duplicates">
          {duplicateCount > 0 ? (
            <span className="text-oms-warn-ink">{duplicateCount}</span>
          ) : (
            <span className="font-medium text-oms-ink-2">{t("ops.duplicatesNone")}</span>
          )}
        </Cell>

        <Cell label={t("ops.attempts")} testId="ops-attempts">
          {/* Never a guessed denominator: Libya's ceiling is 8, and "2 / 3"
              would tell a manager the agent was nearly out of attempts. */}
          {maxAttempts ? `${attemptsCount} / ${maxAttempts}` : attemptsCount}
        </Cell>
      </dl>
    </section>
  );
}

function Cell({
  label,
  testId,
  children,
}: {
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 text-[10px] font-[650] uppercase tracking-[0.07em] text-oms-ink-3">
        {label}
      </dt>
      <dd
        data-testid={testId}
        className="m-0 truncate text-[13px] font-semibold tabular-nums text-oms-ink-1"
      >
        {children}
      </dd>
    </div>
  );
}

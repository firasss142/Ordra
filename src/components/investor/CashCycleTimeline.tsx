"use client";

import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";

/**
 * The cash cycle, stage by stage.
 *
 * This exists to answer "why can't I withdraw yet?" visually, so the question
 * stops arriving by message. In COD the gap between a delivered parcel and
 * money in the bank is real — the carrier holds the cash for weeks — and an
 * investor who can see the amount sitting at each stage stops reading the delay
 * as evasion.
 *
 * Stages map onto the OMS status model: confirmed -> uploaded/scanned ->
 * delivered -> carrier remittance -> settled -> withdrawable.
 */
export interface CycleStage {
  key: string;
  label: string;
  amount: number;
  /** Reached and released — money the investor can act on. */
  cleared?: boolean;
}

export function CashCycleTimeline({
  stages,
  market,
}: {
  stages: CycleStage[];
  market: string;
}) {
  const t = useTranslations("investor.cycle");

  return (
    <section
      aria-label={t("title")}
      className="bg-surface-card border border-line-subtle rounded-[10px] p-4 sm:p-5"
    >
      <h2 className="m-0 text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">
        {t("title")}
      </h2>
      <p className="m-0 mt-1 mb-4 text-[12px] text-ink-muted">{t("hint")}</p>

      {/* Vertical on phones (readable labels), horizontal from sm up. */}
      <ol className="m-0 p-0 list-none flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-0">
        {stages.map((stage, i) => {
          const last = i === stages.length - 1;
          return (
            <li key={stage.key} className="flex sm:flex-col sm:flex-1 gap-3 sm:gap-0 items-start">
              <div className="flex sm:w-full items-center gap-2 sm:gap-0">
                <span
                  aria-hidden="true"
                  className={`shrink-0 rounded-full ${
                    stage.cleared ? "bg-accent" : "bg-line-strong"
                  }`}
                  style={{ width: 10, height: 10 }}
                />
                {!last ? (
                  <span
                    aria-hidden="true"
                    className="hidden sm:block h-[2px] flex-1 bg-line-subtle"
                  />
                ) : null}
              </div>

              <div className="sm:mt-2 sm:pe-3">
                <p className="m-0 text-[11px] uppercase tracking-wide text-ink-secondary">
                  {stage.label}
                </p>
                <p
                  className={`m-0 text-[14px] font-semibold tabular-nums ${
                    stage.cleared ? "text-ink-primary" : "text-ink-secondary"
                  }`}
                >
                  {formatCurrency(stage.amount, market)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

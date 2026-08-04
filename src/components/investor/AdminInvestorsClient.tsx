"use client";

import { useState } from "react";
import { AdminInvestorsPanel } from "./AdminInvestorsPanel";
import { AdminWithdrawalsPanel } from "./AdminWithdrawalsPanel";
import { AdminCorrectionsPanel } from "./AdminCorrectionsPanel";
import { AdminSettlementPanel } from "./AdminSettlementPanel";
import { AdminPositionsPanel } from "./AdminPositionsPanel";

const TABS = [
  { key: "investors", label: "Investisseurs" },
  { key: "positions", label: "Positions" },
  { key: "settlements", label: "Clôtures" },
  { key: "withdrawals", label: "Retraits" },
  { key: "corrections", label: "Corrections" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * Admin surface for investor capital and settlements.
 *
 * Five panels used to stack on one scroll with no way to focus any of them, so
 * an operator paying a withdrawal scrolled past a period-close form whose
 * confirm button writes an irreversible ledger entry. Tabs put one job on
 * screen at a time and keep the dangerous one behind a deliberate click.
 *
 * Settlement still defaults to a DRY RUN — committing writes to an append-only
 * ledger, so a mistaken run cannot be edited away, only corrected forward.
 */
export function AdminInvestorsClient({
  markets,
  locale,
}: {
  markets: { id: string; code: string; name: string }[];
  locale: string;
}) {
  const [tab, setTab] = useState<TabKey>("investors");

  return (
    <div className="flex flex-col gap-4">
      {/* Underline tabs — design-system §4.11. The 2px accent underline is one
          of the accent colour's two reserved slots. */}
      <div
        role="tablist"
        aria-label="Sections investisseurs"
        className="flex items-end gap-1 overflow-x-auto border-b border-line"
      >
        {TABS.map(({ key, label }) => {
          const active = tab === key;
          return (
            <button
              type="button"
              key={key}
              role="tab"
              aria-selected={active}
              aria-controls={`investor-tab-${key}`}
              onClick={() => setTab(key)}
              className={`relative cursor-pointer whitespace-nowrap border-0 bg-transparent px-3 pb-2 pt-1.5 text-[13px] transition-colors duration-fast ${
                active
                  ? "font-semibold text-ink-primary"
                  : "font-medium text-ink-secondary hover:text-ink-primary"
              }`}
            >
              {label}
              {active ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-2 bottom-0 h-[2px] rounded-pill bg-accent"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <div id={`investor-tab-${tab}`} role="tabpanel">
        {tab === "investors" ? <AdminInvestorsPanel markets={markets} locale={locale} /> : null}
        {tab === "positions" ? <AdminPositionsPanel markets={markets} locale={locale} /> : null}
        {tab === "settlements" ? <AdminSettlementPanel markets={markets} locale={locale} /> : null}
        {tab === "withdrawals" ? (
          <AdminWithdrawalsPanel markets={markets} locale={locale} />
        ) : null}
        {tab === "corrections" ? <AdminCorrectionsPanel /> : null}
      </div>
    </div>
  );
}

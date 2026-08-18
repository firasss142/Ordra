"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AdminInvestorsPanel } from "./AdminInvestorsPanel";
import { AdminDealsPanel } from "./AdminDealsPanel";
import { AdminClosePanel } from "./AdminClosePanel";
import { AdminWithdrawalsPanel } from "./AdminWithdrawalsPanel";
import { AdminCorrectionsPanel } from "./AdminCorrectionsPanel";
import { AdminRollupPanel } from "./AdminRollupPanel";

export type AdminTab = "investors" | "deals" | "close" | "withdrawals" | "corrections" | "rollup";
const TABS: AdminTab[] = ["investors", "deals", "close", "withdrawals", "corrections", "rollup"];

/** Admin console for investor v2 — six tabs, one page. Everything writes through SECURITY DEFINER RPCs behind super_admin routes. */
export function AdminInvestorsClient({ locale, initialTab = "investors", investorsHref }: { locale: string; initialTab?: AdminTab; investorsHref: string }) {
  const t = useTranslations("investorAdmin");
  const [tab, setTab] = useState<AdminTab>(initialTab);
  const [ctx, setCtx] = useState<{ investorId?: string; dealId?: string }>({});
  const go = (next: AdminTab, c?: { investorId?: string; dealId?: string }) => { if (c) setCtx((x) => ({ ...x, ...c })); setTab(next); };
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-end gap-4">
        <div>
          <h1 className="m-0 text-[26px] font-semibold tracking-[-0.02em] text-oms-ink-1">{t(`tabs.${tab}`)}</h1>
          <p className="m-0 mt-1 text-[12.5px] text-oms-ink-2">{t(`meta.${tab}`)}</p>
        </div>
      </header>
      <nav className="flex gap-5 border-b border-oms-border text-[13px]" role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-0.5 pb-2.5 pt-2 font-semibold ${tab === k ? "border-oms-ink-1 text-oms-ink-1" : "border-transparent text-oms-ink-2 hover:text-oms-ink-1"}`}>{t(`tabs.${k}`)}</button>
        ))}
      </nav>
      {tab === "investors" && <AdminInvestorsPanel locale={locale} go={go} investorsHref={investorsHref} />}
      {tab === "deals" && <AdminDealsPanel locale={locale} go={go} initialDealId={ctx.dealId} initialInvestorId={ctx.investorId} />}
      {tab === "close" && <AdminClosePanel locale={locale} initialInvestorId={ctx.investorId} />}
      {tab === "withdrawals" && <AdminWithdrawalsPanel locale={locale} />}
      {tab === "corrections" && <AdminCorrectionsPanel locale={locale} initialInvestorId={ctx.investorId} />}
      {tab === "rollup" && <AdminRollupPanel locale={locale} />}
    </div>
  );
}

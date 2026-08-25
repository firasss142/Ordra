"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { PortfolioPayload } from "@/lib/investors/portfolio-summary";
import type { AuthUser } from "@/types";
import { PORTFOLIO_KEY } from "./PortfolioClient";

export function AccountClient({ user, locale }: { user: AuthUser; locale: string }) {
  const t = useTranslations("investor.account");
  const router = useRouter();
  const { data } = useSWR<{ data: PortfolioPayload }>(PORTFOLIO_KEY, fetcher);
  const p = data?.data;
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); router.push(`/${locale}/login`); router.refresh(); }
  const rows: [string, string][] = [
    [t("legalName"), p?.investor.legal_name ?? "—"],
    [t("email"), user.email ?? "—"],
    [t("market"), p?.investor.market_id ? (locale === "ar" ? (p.investor.currency === "LYD" ? "ليبيا" : "تونس") : (p.investor.currency === "LYD" ? "Libye" : "Tunisie")) : "—"],
    [t("currency"), p?.investor.currency ?? "—"],
    [t("payout"), p?.investor.payout_method ? t(p.investor.payout_method as "bank_transfer" | "cash" | "wallet") : "—"],
    [t("deals"), p ? String(p.deals.length) : "—"],
  ];
  return (
    <div className="flex flex-col gap-3.5">
      <h1 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">{t("title")}</h1>
      <section className="rounded-[10px] border border-oms-border bg-oms-surface px-3.5 py-1">
        <dl className="m-0 divide-y divide-oms-border text-[13px]">
          {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-2.5"><dt className="text-oms-ink-2">{k}</dt><dd className="m-0 text-end font-semibold">{v}</dd></div>)}
        </dl>
        {p && !p.investor.legal_name && <div className="pb-2 text-[12px] text-oms-ink-3">{t("notConfigured")}</div>}
      </section>
      <button type="button" onClick={signOut} className="h-10 rounded-lg border border-oms-border-strong bg-oms-surface text-[13px] font-semibold">{t("signOut")}</button>
    </div>
  );
}

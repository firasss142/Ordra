import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canManageInvestments, canViewInvestorAdmin } from "@/lib/investor-permissions";
import { marketIdToCode } from "@/lib/markets";
import { InvestorsPage } from "@/components/finance/investors/InvestorsPage";
import { AdminInvestorsClient, type AdminTab } from "@/components/investor/AdminInvestorsClient";

export const dynamic = "force-dynamic";

/**
 * Finances › Investisseurs — prototypes/finances-investisseurs-v1.html: how
 * their money works, one card per person. `?view=console&tab=…` opens the
 * investor console (six tabs), which holds every write — contracts, closing a
 * month, payments, corrections, the rollup. super_admin writes; a market
 * manager reads their own market.
 */
export default async function AdminInvestorsPage({ params, searchParams }: { params: { locale: string }; searchParams?: { tab?: string; view?: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "investor") redirect(`/${params.locale}/investor`);
  if (!canViewInvestorAdmin(user.role)) redirect(`/${params.locale}/dashboard`);

  if (searchParams?.view === "console") {
    const tabs: AdminTab[] = ["investors", "deals", "close", "withdrawals", "corrections", "rollup"];
    const initialTab = tabs.includes(searchParams?.tab as AdminTab) ? (searchParams!.tab as AdminTab) : "investors";
    return (
      <div className="flex min-h-screen flex-col gap-4 bg-oms-bg px-4 pb-20 pt-16 md:px-6 md:pb-20 md:pt-6">
        <a href={`/${params.locale}/finance/investors`} className="text-[13px] font-semibold text-oms-ink-2 hover:text-oms-ink-1">
          ← {(await getTranslations({ locale: params.locale, namespace: "financeInvestors" }))("title")}
        </a>
        <AdminInvestorsClient locale={params.locale} initialTab={initialTab} investorsHref={`/${params.locale}/users`} />
      </div>
    );
  }

  const { marketId } = await getActiveMarketScope(user);
  const code = marketIdToCode(marketId);
  const tNav = await getTranslations({ locale: params.locale, namespace: "nav" });
  return (
    <InvestorsPage
      marketId={marketId}
      marketName={code ? tNav(`markets.${code}`) : tNav("markets.all")}
      locale={params.locale}
      canManage={canManageInvestments(user.role)}
    />
  );
}

import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewInvestorAdmin } from "@/lib/investor-permissions";
import { AdminInvestorsClient, type AdminTab } from "@/components/investor/AdminInvestorsClient";

export const dynamic = "force-dynamic";

/**
 * Admin console for investor v2 (six tabs). super_admin writes; market_manager
 * reads its own market — the same allow-lists are enforced again in every
 * route the page calls.
 */
export default async function AdminInvestorsPage({ params, searchParams }: { params: { locale: string }; searchParams?: { tab?: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "investor") redirect(`/${params.locale}/investor`);
  if (!canViewInvestorAdmin(user.role)) redirect(`/${params.locale}/dashboard`);
  const tabs: AdminTab[] = ["investors", "deals", "close", "withdrawals", "corrections", "rollup"];
  const initialTab = tabs.includes(searchParams?.tab as AdminTab) ? (searchParams!.tab as AdminTab) : "investors";
  return (
    <div className="flex min-h-screen flex-col gap-4 bg-oms-bg px-4 pb-20 pt-16 md:px-6 md:pb-20 md:pt-6">
      <AdminInvestorsClient locale={params.locale} initialTab={initialTab} investorsHref={`/${params.locale}/users`} />
    </div>
  );
}
